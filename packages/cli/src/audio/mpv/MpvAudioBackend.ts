import { randomUUID } from "node:crypto";
import { type ChildProcess, spawn } from "node:child_process";
import { createConnection, type Socket } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { applyVolumeForTier, interpolatePerceptualVolume } from "../perceptual.js";
import { detectMpvPresent, isOnPath } from "../detect.js";
import type { AudioBackend, BackendCapabilities, PlaybackOptions, PlayerHandle } from "../types.js";

export type MpvAudioBackendOptions = {
  env?: NodeJS.ProcessEnv;
  /** Absolute path to mpv; default resolves from PATH at detect/play time. */
  mpvPath?: string;
  /** Steps for fade volume ramps (inclusive endpoints). */
  fadeSteps?: number;
  /** Override presence check (tests). */
  isPresent?: (env: NodeJS.ProcessEnv) => boolean;
  /** Inject spawn for tests. */
  spawnFn?: typeof spawn;
  /** Inject IPC connect for tests. */
  connectFn?: (path: string) => Socket;
  /** Inject IPC socket readiness wait (tests). */
  waitForIpc?: (path: string, timeoutMs: number) => Promise<void>;
};

type ActiveSession = {
  handle: PlayerHandle;
  child: ChildProcess;
  ipcPath: string;
  runtimeDir: string;
  socket: Socket | null;
  volume: number;
  stopping: boolean;
  stopEpoch: number;
  fadeTimer: ReturnType<typeof setInterval> | null;
  /** Resolves an in-flight volume ramp when cancelled. */
  fadeCancel: (() => void) | null;
};

/**
 * Tier-2 mpv adapter (PC-303 / §11.3).
 *
 * Passes perceptual 0–100 through to mpv's `volume` property (no double-map).
 * Detection uses PATH; hook commands never rely on PATH themselves.
 */
export class MpvAudioBackend implements AudioBackend {
  readonly #env: NodeJS.ProcessEnv;
  readonly #mpvPathOverride: string | undefined;
  readonly #fadeSteps: number;
  readonly #isPresent: (env: NodeJS.ProcessEnv) => boolean;
  readonly #spawn: typeof spawn;
  readonly #connect: (path: string) => Socket;
  readonly #waitForIpc: (path: string, timeoutMs: number) => Promise<void>;
  readonly #lostListeners = new Set<(handle: PlayerHandle) => void>();

  #session: ActiveSession | null = null;

  constructor(options: MpvAudioBackendOptions = {}) {
    this.#env = options.env ?? process.env;
    this.#mpvPathOverride = options.mpvPath;
    this.#fadeSteps = Math.max(2, options.fadeSteps ?? 8);
    this.#isPresent = options.isPresent ?? detectMpvPresent;
    this.#spawn = options.spawnFn ?? spawn;
    this.#connect = options.connectFn ?? ((path) => createConnection(path));
    this.#waitForIpc = options.waitForIpc ?? ((path, ms) => this.#defaultWaitForSocket(path, ms));
  }

  onHandleLost(listener: (handle: PlayerHandle) => void): () => void {
    this.#lostListeners.add(listener);
    return () => {
      this.#lostListeners.delete(listener);
    };
  }

  detect(): Promise<BackendCapabilities> {
    const present = this.#isPresent(this.#env) || Boolean(this.#mpvPathOverride);
    if (!present) {
      return Promise.resolve({
        available: false,
        tier: "none",
        name: "mpv",
        loop: false,
        fade: false,
        runtimeVolume: false,
      });
    }
    return Promise.resolve({
      available: true,
      tier: "mpv",
      name: "mpv",
      loop: true,
      fade: true,
      runtimeVolume: true,
    });
  }

  async play(options: PlaybackOptions): Promise<PlayerHandle> {
    const mpv = this.#resolveMpv();
    if (!mpv) {
      throw new Error("MpvAudioBackend: mpv not found on PATH");
    }

    const applied = applyVolumeForTier("mpv", options.volume);
    const volume = applied.perceptual;

    if (this.#session?.stopping) {
      const session = this.#session;
      session.stopEpoch++;
      session.stopping = false;
      this.#cancelFade(session);
      session.volume = volume;
      await this.#ipc(session, ["set_property", "volume", volume]);
      return session.handle;
    }

    if (this.#session) {
      await this.#forceQuit(this.#session).catch(() => undefined);
      this.#session = null;
    }

    const runtimeDir = await mkdtemp(join(tmpdir(), "purrcode-mpv-"));
    const ipcPath = join(runtimeDir, "mpv.sock");
    const handle: PlayerHandle = { id: randomUUID() };
    const fadeInMs = options.fadeInMs ?? 0;
    const startVolume = fadeInMs > 0 ? 0 : volume;

    const child = this.#spawn(
      mpv,
      [
        "--no-video",
        "--no-terminal",
        "--really-quiet",
        "--loop=inf",
        "--osd-level=0",
        `--volume=${startVolume}`,
        `--input-ipc-server=${ipcPath}`,
        options.soundPath,
      ],
      {
        stdio: ["ignore", "ignore", "ignore"],
        windowsHide: true,
        shell: false,
        env: this.#env,
      },
    );

    const session: ActiveSession = {
      handle,
      child,
      ipcPath,
      runtimeDir,
      socket: null,
      volume,
      stopping: false,
      stopEpoch: 0,
      fadeTimer: null,
      fadeCancel: null,
    };
    this.#session = session;

    child.once("exit", () => {
      if (this.#session?.handle.id !== handle.id) return;
      const wasStopping = this.#session.stopping;
      void rm(runtimeDir, { recursive: true, force: true }).catch(() => undefined);
      this.#session = null;
      if (!wasStopping) {
        this.#notifyLost(handle);
      }
    });

    await this.#waitForIpc(ipcPath, 5_000);
    session.socket = this.#connect(ipcPath);
    await this.#waitConnected(session.socket, 5_000);

    if (fadeInMs > 0) {
      await this.#rampVolume(session, 0, volume, fadeInMs);
    } else {
      await this.#ipc(session, ["set_property", "volume", volume]);
    }
    return handle;
  }

  async setVolume(handle: PlayerHandle, volume: number): Promise<void> {
    const session = this.#assertSession(handle);
    const applied = applyVolumeForTier("mpv", volume);
    session.volume = applied.perceptual;
    await this.#ipc(session, ["set_property", "volume", applied.perceptual]);
  }

  async stop(handle: PlayerHandle, fadeOutMs: number): Promise<void> {
    const session = this.#assertSession(handle);
    const epoch = ++session.stopEpoch;
    session.stopping = true;
    const ms = Math.max(0, fadeOutMs);

    try {
      if (ms > 0) {
        await this.#rampVolume(session, session.volume, 0, ms, () => epoch !== session.stopEpoch);
        if (epoch !== session.stopEpoch) return;
      }
      await this.#ipc(session, ["quit"]).catch(() => undefined);
      await this.#waitExit(session.child, 5_000);
    } catch {
      if (epoch !== session.stopEpoch) return;
      await this.#forceQuit(session).catch(() => undefined);
    } finally {
      if (epoch === session.stopEpoch && this.#session?.handle.id === handle.id) {
        this.#session = null;
      }
      void rm(session.runtimeDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  #resolveMpv(): string | null {
    if (this.#mpvPathOverride) return this.#mpvPathOverride;
    if (isOnPath("mpv", this.#env)) return "mpv";
    return null;
  }

  #assertSession(handle: PlayerHandle): ActiveSession {
    if (!this.#session || this.#session.handle.id !== handle.id) {
      throw new Error(`MpvAudioBackend: unknown or stale player handle ${handle.id}`);
    }
    return this.#session;
  }

  #cancelFade(session: ActiveSession): void {
    if (session.fadeTimer !== null) {
      clearInterval(session.fadeTimer);
      session.fadeTimer = null;
    }
    const cancel = session.fadeCancel;
    session.fadeCancel = null;
    cancel?.();
  }

  async #rampVolume(
    session: ActiveSession,
    from: number,
    to: number,
    durationMs: number,
    isCancelled?: () => boolean,
  ): Promise<void> {
    this.#cancelFade(session);
    if (durationMs <= 0) {
      await this.#ipc(session, ["set_property", "volume", to]);
      session.volume = to;
      return;
    }
    const steps = this.#fadeSteps;
    const samples: number[] = [];
    for (let i = 0; i < steps; i++) {
      samples.push(interpolatePerceptualVolume(from, to, i / (steps - 1)));
    }
    const interval = Math.max(1, Math.floor(durationMs / (steps - 1)));

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        session.fadeCancel = null;
        if (session.fadeTimer !== null) {
          clearInterval(session.fadeTimer);
          session.fadeTimer = null;
        }
        resolve();
      };
      session.fadeCancel = finish;

      let idx = 0;
      const tick = () => {
        if (isCancelled?.()) {
          finish();
          return;
        }
        const v = samples[idx]!;
        session.volume = v;
        void this.#ipc(session, ["set_property", "volume", v]).catch((err: unknown) => {
          if (settled) return;
          settled = true;
          session.fadeCancel = null;
          if (session.fadeTimer !== null) {
            clearInterval(session.fadeTimer);
            session.fadeTimer = null;
          }
          reject(err instanceof Error ? err : new Error(String(err)));
        });
        idx++;
        if (idx >= samples.length) {
          finish();
        }
      };
      tick();
      if (!settled && samples.length > 1) {
        session.fadeTimer = setInterval(tick, interval);
      }
    });
  }

  #ipc(session: ActiveSession, command: unknown[]): Promise<void> {
    const socket = session.socket;
    if (!socket || socket.destroyed) {
      return Promise.reject(new Error("MpvAudioBackend: IPC socket not connected"));
    }
    const line = `${JSON.stringify({ command })}\n`;
    return new Promise((resolve, reject) => {
      socket.write(line, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async #forceQuit(session: ActiveSession): Promise<void> {
    session.stopping = true;
    this.#cancelFade(session);
    try {
      await this.#ipc(session, ["quit"]);
    } catch {
      // ignore
    }
    try {
      session.child.kill("SIGKILL");
    } catch {
      // ignore
    }
    await this.#waitExit(session.child, 2_000);
    try {
      session.socket?.destroy();
    } catch {
      // ignore
    }
    void rm(session.runtimeDir, { recursive: true, force: true }).catch(() => undefined);
  }

  #defaultWaitForSocket(path: string, timeoutMs: number): Promise<void> {
    const start = Date.now();
    return new Promise((resolve, reject) => {
      const tryOnce = () => {
        const sock = createConnection(path);
        sock.once("connect", () => {
          sock.destroy();
          resolve();
        });
        sock.once("error", () => {
          sock.destroy();
          if (Date.now() - start >= timeoutMs) {
            reject(new Error("MpvAudioBackend: timed out waiting for IPC socket"));
            return;
          }
          setTimeout(tryOnce, 25);
        });
      };
      tryOnce();
    });
  }

  #waitConnected(socket: Socket, timeoutMs: number): Promise<void> {
    if (!socket.connecting && !socket.destroyed) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("MpvAudioBackend: IPC connect timeout"));
      }, timeoutMs);
      socket.once("connect", () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  #waitExit(child: ChildProcess, timeoutMs: number): Promise<void> {
    if (child.exitCode !== null) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
        resolve();
      }, timeoutMs);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  #notifyLost(handle: PlayerHandle): void {
    for (const listener of this.#lostListeners) {
      try {
        listener(handle);
      } catch {
        // fail-open
      }
    }
  }
}
