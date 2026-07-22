import { randomUUID } from "node:crypto";
import { type ChildProcess, spawn } from "node:child_process";
import { createInterface, type Interface } from "node:readline";

import { applyVolumeForTier } from "../perceptual.js";
import type { AudioBackend, BackendCapabilities, PlaybackOptions, PlayerHandle } from "../types.js";
import { encodeSidecarCommand, parseSidecarEventLine, type SidecarEvent } from "./protocol.js";
import { isExecutableFile, resolveSidecarBinaryPath } from "./resolveBinary.js";

export const PURRCODE_SIDECAR_BIN_ENV = "PURRCODE_SIDECAR_BIN";
export const PURRCODE_SIDECAR_NULL_ENV = "PURRCODE_SIDECAR_NULL";

export type SidecarAudioBackendOptions = {
  /** Absolute path to purr-sidecar. When omitted, resolved from optionalDeps / env. */
  binaryPath?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  arch?: string;
  /**
   * Force `--null` (no sound card). Also enabled when `PURRCODE_SIDECAR_NULL=1`.
   */
  useNull?: boolean;
  /** Default fade-in when `play()` omits fadeInMs. */
  defaultFadeInMs?: number;
  /** Volume ramp for setVolume (ms). */
  volumeRampMs?: number;
};

type EventWaiter = {
  resolve: (event: SidecarEvent) => void;
  reject: (err: Error) => void;
};

type ActiveSession = {
  handle: PlayerHandle;
  child: ChildProcess;
  rl: Interface;
  soundPath: string;
  amplitude: number;
  stopping: boolean;
  /** Bumped to cancel an in-flight {@link stop}. */
  stopEpoch: number;
  waiters: Map<string, EventWaiter[]>;
  /** Events that arrived before a waiter was registered. */
  inbox: SidecarEvent[];
};

/**
 * Tier-1 miniaudio sidecar adapter (PC-301).
 *
 * Applies PC-205 perceptual→linear amplitude once, then speaks NDJSON amplitude
 * to the child. Unexpected child exit fires {@link onHandleLost}.
 */
export class SidecarAudioBackend implements AudioBackend {
  readonly #env: NodeJS.ProcessEnv;
  readonly #platform: NodeJS.Platform;
  readonly #arch: string;
  readonly #binaryOverride: string | undefined;
  readonly #useNull: boolean;
  readonly #defaultFadeInMs: number;
  readonly #volumeRampMs: number;
  readonly #lostListeners = new Set<(handle: PlayerHandle) => void>();

  #session: ActiveSession | null = null;

  constructor(options: SidecarAudioBackendOptions = {}) {
    this.#env = options.env ?? process.env;
    this.#platform = options.platform ?? process.platform;
    this.#arch = options.arch ?? process.arch;
    this.#binaryOverride = options.binaryPath;
    const nullEnv = this.#env[PURRCODE_SIDECAR_NULL_ENV];
    this.#useNull = options.useNull ?? (nullEnv === "1" || nullEnv === "true" || nullEnv === "yes");
    this.#defaultFadeInMs = options.defaultFadeInMs ?? 500;
    this.#volumeRampMs = options.volumeRampMs ?? 100;
  }

  onHandleLost(listener: (handle: PlayerHandle) => void): () => void {
    this.#lostListeners.add(listener);
    return () => {
      this.#lostListeners.delete(listener);
    };
  }

  detect(): Promise<BackendCapabilities> {
    const path = this.#resolveBinary();
    if (!path) {
      return Promise.resolve({
        available: false,
        tier: "none",
        name: "sidecar",
        loop: false,
        fade: false,
        runtimeVolume: false,
      });
    }
    return Promise.resolve({
      available: true,
      tier: "sidecar",
      name: "sidecar",
      loop: true,
      fade: true,
      runtimeVolume: true,
    });
  }

  async play(options: PlaybackOptions): Promise<PlayerHandle> {
    const binary = this.#resolveBinary();
    if (!binary) {
      throw new Error("SidecarAudioBackend: binary not found");
    }

    const applied = applyVolumeForTier("sidecar", options.volume);
    if (applied.mode !== "linear-amplitude") {
      throw new Error("SidecarAudioBackend: expected linear-amplitude volume application");
    }
    const amplitude = applied.linearAmplitude;
    const fadeInMs = options.fadeInMs ?? this.#defaultFadeInMs;

    // Fade-cancel: reuse the live child and cancel an in-flight fade-out.
    if (this.#session && this.#session.stopping && this.#session.soundPath === options.soundPath) {
      const session = this.#session;
      session.stopEpoch++;
      session.stopping = false;
      this.#rejectWaiters(session, new Error("SidecarAudioBackend: stop cancelled by play"));
      session.amplitude = amplitude;
      const playing = this.#waitFor(session, "playing", 5_000);
      this.#write(session, { cmd: "volume", amplitude, rampMs: 0 });
      this.#write(session, { cmd: "play", fadeInMs });
      await playing;
      return session.handle;
    }

    if (this.#session) {
      await this.#forceKill(this.#session).catch(() => undefined);
      this.#session = null;
    }

    const handle: PlayerHandle = { id: randomUUID() };
    const args = this.#useNull ? ["--null"] : [];
    const child = spawn(binary, args, {
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
      shell: false,
    });

    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
    const session: ActiveSession = {
      handle,
      child,
      rl,
      soundPath: options.soundPath,
      amplitude,
      stopping: false,
      stopEpoch: 0,
      waiters: new Map(),
      inbox: [],
    };
    this.#session = session;

    rl.on("line", (line) => {
      const event = parseSidecarEventLine(line);
      if (!event) return;
      this.#dispatch(session, event);
    });

    child.once("exit", () => {
      try {
        rl.close();
      } catch {
        // ignore
      }
      if (this.#session?.handle.id !== handle.id) return;
      const wasStopping = this.#session.stopping;
      this.#session = null;
      if (!wasStopping) {
        this.#notifyLost(handle);
      }
    });

    const ready = this.#waitFor(session, "ready", 5_000);
    await ready;
    const loaded = this.#waitFor(session, "loaded", 15_000);
    this.#write(session, { cmd: "load", path: options.soundPath });
    await loaded;
    const volumeAck = this.#waitFor(session, "volume", 5_000);
    this.#write(session, { cmd: "volume", amplitude, rampMs: 0 });
    await volumeAck;
    const playing = this.#waitFor(session, "playing", 5_000);
    this.#write(session, { cmd: "play", fadeInMs });
    await playing;
    return handle;
  }

  async setVolume(handle: PlayerHandle, volume: number): Promise<void> {
    const session = this.#assertSession(handle);
    const applied = applyVolumeForTier("sidecar", volume);
    if (applied.mode !== "linear-amplitude") {
      throw new Error("SidecarAudioBackend: expected linear-amplitude volume application");
    }
    session.amplitude = applied.linearAmplitude;
    const volumeAck = this.#waitFor(session, "volume", 5_000);
    this.#write(session, {
      cmd: "volume",
      amplitude: applied.linearAmplitude,
      rampMs: this.#volumeRampMs,
    });
    await volumeAck;
  }

  async stop(handle: PlayerHandle, fadeOutMs: number): Promise<void> {
    const session = this.#assertSession(handle);
    const epoch = ++session.stopEpoch;
    session.stopping = true;
    const ms = Math.max(0, fadeOutMs);

    try {
      const fadeoutAck = this.#waitFor(session, "fadeout", 5_000);
      this.#write(session, { cmd: "fadeout", ms });
      await fadeoutAck;
      if (epoch !== session.stopEpoch) {
        // Cancelled by play() — leave the child running.
        return;
      }
      const stopped = this.#waitFor(session, "stopped", ms + 5_000);
      await stopped;
      if (epoch !== session.stopEpoch) {
        return;
      }
      this.#write(session, { cmd: "quit" });
      await this.#waitExit(session.child, 5_000);
    } catch {
      if (epoch !== session.stopEpoch) return;
      await this.#forceKill(session).catch(() => undefined);
    } finally {
      if (epoch === session.stopEpoch && this.#session?.handle.id === handle.id) {
        this.#session = null;
      }
    }
  }

  #resolveBinary(): string | null {
    if (this.#binaryOverride) {
      return isExecutableFile(this.#binaryOverride, this.#platform) ? this.#binaryOverride : null;
    }
    return resolveSidecarBinaryPath({
      env: this.#env,
      platform: this.#platform,
      arch: this.#arch,
    });
  }

  #assertSession(handle: PlayerHandle): ActiveSession {
    if (!this.#session || this.#session.handle.id !== handle.id) {
      throw new Error(`SidecarAudioBackend: unknown or stale player handle ${handle.id}`);
    }
    return this.#session;
  }

  #write(session: ActiveSession, command: Parameters<typeof encodeSidecarCommand>[0]): void {
    const stdin = session.child.stdin;
    if (!stdin || stdin.destroyed) return;
    stdin.write(encodeSidecarCommand(command));
  }

  #dispatch(session: ActiveSession, event: SidecarEvent): void {
    const list = session.waiters.get(event.event);
    if (list && list.length > 0) {
      const next = list.shift();
      next?.resolve(event);
      return;
    }
    session.inbox.push(event);
    // Bound memory — keep the most recent handful of unmatched events.
    if (session.inbox.length > 32) {
      session.inbox.splice(0, session.inbox.length - 32);
    }
  }

  #rejectWaiters(session: ActiveSession, err: Error): void {
    for (const list of session.waiters.values()) {
      for (const waiter of list) {
        try {
          waiter.reject(err);
        } catch {
          // ignore
        }
      }
    }
    session.waiters.clear();
    session.inbox.length = 0;
  }

  #waitFor(session: ActiveSession, event: string, timeoutMs: number): Promise<SidecarEvent> {
    const bufferedIdx = session.inbox.findIndex((e) => e.event === event);
    if (bufferedIdx >= 0) {
      const [buffered] = session.inbox.splice(bufferedIdx, 1);
      return Promise.resolve(buffered!);
    }

    return new Promise((resolve, reject) => {
      const waiter: EventWaiter = {
        resolve: (ev) => {
          clearTimeout(timer);
          resolve(ev);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      };

      const timer = setTimeout(() => {
        const list = session.waiters.get(event);
        if (list) {
          const idx = list.indexOf(waiter);
          if (idx >= 0) list.splice(idx, 1);
        }
        reject(new Error(`SidecarAudioBackend: timed out waiting for "${event}"`));
      }, timeoutMs);

      const list = session.waiters.get(event) ?? [];
      list.push(waiter);
      session.waiters.set(event, list);

      if (session.child.exitCode !== null || session.child.killed) {
        clearTimeout(timer);
        reject(new Error(`SidecarAudioBackend: child exited before "${event}"`));
      }
    });
  }

  async #forceKill(session: ActiveSession): Promise<void> {
    session.stopping = true;
    try {
      this.#write(session, { cmd: "quit" });
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
      session.rl.close();
    } catch {
      // ignore
    }
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
