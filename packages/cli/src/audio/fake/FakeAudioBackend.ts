import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import type { AudioBackend, BackendCapabilities, PlaybackOptions, PlayerHandle } from "../types.js";
import type { FakeAudioEvent } from "./events.js";

export const PURRCODE_FAKE_AUDIO_ENV = "PURRCODE_FAKE_AUDIO";
export const PURRCODE_FAKE_AUDIO_LOG_ENV = "PURRCODE_FAKE_AUDIO_LOG";

type Phase = "idle" | "playing" | "fading";

export type FakeAudioBackendOptions = {
  /** JSONL log path. Required so tests and CI choose an isolated file. */
  logPath: string;
  /** Clock override for deterministic timestamps in tests. */
  now?: () => number;
  /**
   * Override env detection. When omitted, `detect()` follows
   * `PURRCODE_FAKE_AUDIO`.
   */
  enabled?: boolean;
};

/** True when the fake backend should win tier detection. */
export function isFakeAudioEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env[PURRCODE_FAKE_AUDIO_ENV];
  return value === "1" || value === "true" || value === "yes";
}

/** Resolve log path from env, or a per-process temp file. */
export function resolveFakeAudioLogPath(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env[PURRCODE_FAKE_AUDIO_LOG_ENV];
  if (fromEnv !== undefined && fromEnv !== "") {
    return fromEnv;
  }
  return join(tmpdir(), `purrcode-fake-audio-${process.pid}.jsonl`);
}

/**
 * `AudioBackend` that records playback lifecycle to JSONL instead of a sound card.
 * Activated by `PURRCODE_FAKE_AUDIO=1` (PC-101 / §23.5).
 */
export class FakeAudioBackend implements AudioBackend {
  readonly logPath: string;

  readonly #now: () => number;
  readonly #enabledOverride: boolean | undefined;

  #phase: Phase = "idle";
  #handle: PlayerHandle | null = null;
  #volume = 0;
  #readyEmitted = false;
  #fadeTimer: ReturnType<typeof setTimeout> | null = null;
  #fadeDone: (() => void) | null = null;
  #writeChain: Promise<void> = Promise.resolve();

  constructor(options: FakeAudioBackendOptions) {
    this.logPath = options.logPath;
    this.#now = options.now ?? (() => Date.now());
    this.#enabledOverride = options.enabled;
  }

  /** Convenience constructor using env log path + `PURRCODE_FAKE_AUDIO`. */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): FakeAudioBackend {
    return new FakeAudioBackend({
      logPath: resolveFakeAudioLogPath(env),
    });
  }

  async detect(): Promise<BackendCapabilities> {
    const available =
      this.#enabledOverride !== undefined ? this.#enabledOverride : isFakeAudioEnabled();

    if (available && !this.#readyEmitted) {
      this.#readyEmitted = true;
      await this.#emit({
        type: "ready",
        sidecar: "ready",
      });
    }

    if (!available) {
      return {
        available: false,
        tier: "none",
        name: "fake",
        loop: false,
        fade: false,
        runtimeVolume: false,
      };
    }

    return {
      available: true,
      tier: "fake",
      name: "fake",
      loop: true,
      fade: true,
      runtimeVolume: true,
    };
  }

  async play(options: PlaybackOptions): Promise<PlayerHandle> {
    if (this.#phase === "fading") {
      this.#cancelFadeTimer();
      await this.#emit({
        type: "fade-cancel",
        volume: this.#volume,
        ...(this.#handle !== null ? { handleId: this.#handle.id } : {}),
      });
    }

    const handle: PlayerHandle = { id: randomUUID() };
    this.#handle = handle;
    this.#volume = options.volume;
    this.#phase = "playing";

    await this.#emit({
      type: "start",
      sidecar: "playing",
      handleId: handle.id,
      volume: options.volume,
      soundPath: options.soundPath,
      ...(options.fadeInMs !== undefined ? { fadeInMs: options.fadeInMs } : {}),
    });

    return handle;
  }

  async setVolume(handle: PlayerHandle, volume: number): Promise<void> {
    this.#assertHandle(handle);
    this.#volume = volume;
    await this.#emit({
      type: "volume-change",
      sidecar: "volume",
      handleId: handle.id,
      volume,
    });
  }

  async stop(handle: PlayerHandle, fadeOutMs: number): Promise<void> {
    this.#assertHandle(handle);
    if (this.#phase === "idle") {
      return;
    }
    if (this.#phase === "fading") {
      await this.#waitForFade();
      return;
    }

    this.#phase = "fading";
    const ms = Math.max(0, fadeOutMs);
    await this.#emit({
      type: "fade-start",
      sidecar: "fadeout",
      handleId: handle.id,
      volume: this.#volume,
      fadeOutMs: ms,
    });

    if (ms === 0) {
      await this.#finishStop(handle);
      return;
    }

    await new Promise<void>((resolve) => {
      this.#fadeDone = resolve;
      this.#fadeTimer = setTimeout(() => {
        this.#fadeTimer = null;
        void this.#finishStop(handle).finally(() => {
          const done = this.#fadeDone;
          this.#fadeDone = null;
          done?.();
        });
      }, ms);
    });
  }

  async #finishStop(handle: PlayerHandle): Promise<void> {
    if (this.#handle?.id !== handle.id) {
      return;
    }
    await this.#emit({
      type: "stop",
      sidecar: "exiting",
      handleId: handle.id,
      volume: this.#volume,
    });
    this.#phase = "idle";
    this.#handle = null;
  }

  #cancelFadeTimer(): void {
    if (this.#fadeTimer !== null) {
      clearTimeout(this.#fadeTimer);
      this.#fadeTimer = null;
    }
    const done = this.#fadeDone;
    this.#fadeDone = null;
    done?.();
  }

  async #waitForFade(): Promise<void> {
    if (this.#fadeDone === null) {
      return;
    }
    await new Promise<void>((resolve) => {
      const prev = this.#fadeDone;
      this.#fadeDone = () => {
        prev?.();
        resolve();
      };
    });
  }

  #assertHandle(handle: PlayerHandle): void {
    if (this.#handle === null || this.#handle.id !== handle.id) {
      throw new Error(`FakeAudioBackend: unknown or stale player handle ${handle.id}`);
    }
  }

  async #emit(partial: Omit<FakeAudioEvent, "ts">): Promise<void> {
    const event: FakeAudioEvent = {
      ts: this.#now(),
      type: partial.type,
      ...(partial.sidecar !== undefined ? { sidecar: partial.sidecar } : {}),
      ...(partial.handleId !== undefined ? { handleId: partial.handleId } : {}),
      ...(partial.volume !== undefined ? { volume: partial.volume } : {}),
      ...(partial.soundPath !== undefined ? { soundPath: partial.soundPath } : {}),
      ...(partial.fadeInMs !== undefined ? { fadeInMs: partial.fadeInMs } : {}),
      ...(partial.fadeOutMs !== undefined ? { fadeOutMs: partial.fadeOutMs } : {}),
    };

    // Serialize writes so concurrent lifecycle calls don't interleave JSON lines.
    this.#writeChain = this.#writeChain.then(async () => {
      await mkdir(dirname(this.logPath), { recursive: true });
      await appendFile(this.logPath, `${JSON.stringify(event)}\n`, "utf8");
    });
    await this.#writeChain;
  }
}
