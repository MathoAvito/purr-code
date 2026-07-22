import { randomUUID } from "node:crypto";
import { type ChildProcess, spawn } from "node:child_process";

import { detectNativePresent, isOnPath } from "../detect.js";
import { ensureWavCache } from "../wavCache.js";
import type { AudioBackend, BackendCapabilities, PlaybackOptions, PlayerHandle } from "../types.js";

/**
 * Tier-3 native players (PC-304 / §11.3):
 * - macOS: `afplay`
 * - Linux: `paplay` then `aplay`
 * - Windows: PowerShell `System.Media.SoundPlayer`
 *
 * Seamed loop via respawn-on-exit. Hard stop (no fade). No runtime volume.
 * Always plays the canonical WAV cache — never the original OGG.
 */

export type NativeAudioBackendOptions = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** Inject player binary resolution (tests). */
  resolvePlayer?: () => NativePlayer | null;
  /** Inject spawn (tests). */
  spawnFn?: typeof spawn;
  /** Override ensureWavCache (tests). */
  ensureWav?: typeof ensureWavCache;
  isPresent?: (env: NodeJS.ProcessEnv, platform: NodeJS.Platform) => boolean;
};

export type NativePlayer =
  | { kind: "afplay"; bin: string }
  | { kind: "paplay"; bin: string }
  | { kind: "aplay"; bin: string }
  | { kind: "powershell"; bin: string };

type ActiveSession = {
  handle: PlayerHandle;
  wavPath: string;
  player: NativePlayer;
  child: ChildProcess | null;
  looping: boolean;
  stopEpoch: number;
};

export class NativeAudioBackend implements AudioBackend {
  readonly #env: NodeJS.ProcessEnv;
  readonly #platform: NodeJS.Platform;
  readonly #resolvePlayer: () => NativePlayer | null;
  readonly #spawn: typeof spawn;
  readonly #ensureWav: typeof ensureWavCache;
  readonly #isPresent: (env: NodeJS.ProcessEnv, platform: NodeJS.Platform) => boolean;
  readonly #lostListeners = new Set<(handle: PlayerHandle) => void>();

  #session: ActiveSession | null = null;

  constructor(options: NativeAudioBackendOptions = {}) {
    this.#env = options.env ?? process.env;
    this.#platform = options.platform ?? process.platform;
    this.#resolvePlayer =
      options.resolvePlayer ?? (() => defaultResolvePlayer(this.#env, this.#platform));
    this.#spawn = options.spawnFn ?? spawn;
    this.#ensureWav = options.ensureWav ?? ensureWavCache;
    this.#isPresent = options.isPresent ?? detectNativePresent;
  }

  onHandleLost(listener: (handle: PlayerHandle) => void): () => void {
    this.#lostListeners.add(listener);
    return () => {
      this.#lostListeners.delete(listener);
    };
  }

  detect(): Promise<BackendCapabilities> {
    const player = this.#resolvePlayer();
    const present = this.#isPresent(this.#env, this.#platform) && player !== null;
    if (!present || !player) {
      return Promise.resolve({
        available: false,
        tier: "none",
        name: "native",
        loop: false,
        fade: false,
        runtimeVolume: false,
      });
    }
    return Promise.resolve({
      available: true,
      tier: "native",
      name: player.kind,
      loop: false, // seamed respawn — honest for doctor
      fade: false,
      runtimeVolume: false,
    });
  }

  async play(options: PlaybackOptions): Promise<PlayerHandle> {
    const player = this.#resolvePlayer();
    if (!player) {
      throw new Error("NativeAudioBackend: no native player available");
    }

    if (this.#session) {
      await this.stop(this.#session.handle, 0).catch(() => undefined);
    }

    const cached = await this.#ensureWav({
      sourcePath: options.soundPath,
      env: this.#env,
      platform: this.#platform,
    });

    const handle: PlayerHandle = { id: randomUUID() };
    const session: ActiveSession = {
      handle,
      wavPath: cached.wavPath,
      player,
      child: null,
      looping: true,
      stopEpoch: 0,
    };
    this.#session = session;
    this.#spawnLoop(session);
    return handle;
  }

  async stop(handle: PlayerHandle, _fadeOutMs: number): Promise<void> {
    void _fadeOutMs; // tier-3: hard stop only
    const session = this.#assertSession(handle);
    session.stopEpoch++;
    session.looping = false;
    const child = session.child;
    session.child = null;
    if (child && child.exitCode === null) {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
      await waitExit(child, 2_000);
    }
    if (this.#session?.handle.id === handle.id) {
      this.#session = null;
    }
  }

  #assertSession(handle: PlayerHandle): ActiveSession {
    if (!this.#session || this.#session.handle.id !== handle.id) {
      throw new Error(`NativeAudioBackend: unknown or stale player handle ${handle.id}`);
    }
    return this.#session;
  }

  #spawnLoop(session: ActiveSession): void {
    if (!session.looping || this.#session?.handle.id !== session.handle.id) return;
    const epoch = session.stopEpoch;
    const { bin, args, env } = buildSpawn(session.player, session.wavPath, this.#env);
    const child = this.#spawn(bin, args, {
      stdio: ["ignore", "ignore", "ignore"],
      shell: false,
      windowsHide: true,
      env,
    });
    session.child = child;

    child.once("exit", () => {
      if (this.#session?.handle.id !== session.handle.id) return;
      if (!session.looping || session.stopEpoch !== epoch) return;
      // Respawn for seamed loop (documented degradation).
      this.#spawnLoop(session);
    });

    child.once("error", () => {
      if (this.#session?.handle.id !== session.handle.id) return;
      session.looping = false;
      this.#session = null;
      this.#notifyLost(session.handle);
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

export function defaultResolvePlayer(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): NativePlayer | null {
  if (platform === "darwin" && isOnPath("afplay", env)) {
    return { kind: "afplay", bin: "afplay" };
  }
  if (platform === "win32") {
    if (isOnPath("powershell", env)) return { kind: "powershell", bin: "powershell" };
    if (isOnPath("pwsh", env)) return { kind: "powershell", bin: "pwsh" };
    return null;
  }
  if (isOnPath("paplay", env)) return { kind: "paplay", bin: "paplay" };
  if (isOnPath("aplay", env)) return { kind: "aplay", bin: "aplay" };
  return null;
}

function buildSpawn(
  player: NativePlayer,
  wavPath: string,
  baseEnv: NodeJS.ProcessEnv,
): { bin: string; args: string[]; env: NodeJS.ProcessEnv } {
  switch (player.kind) {
    case "afplay":
      return { bin: player.bin, args: [wavPath], env: baseEnv };
    case "paplay":
      return { bin: player.bin, args: [wavPath], env: baseEnv };
    case "aplay":
      return { bin: player.bin, args: ["-q", wavPath], env: baseEnv };
    case "powershell":
      // Path via env — never interpolate into -Command (AGENTS.md hard constraint).
      return {
        bin: player.bin,
        args: [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "$p = New-Object System.Media.SoundPlayer $env:PURRCODE_WAV; $p.PlaySync()",
        ],
        env: { ...baseEnv, PURRCODE_WAV: wavPath },
      };
  }
}

function waitExit(child: ChildProcess, timeoutMs: number): Promise<void> {
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
