import type { AudioBackend, PlayerHandle } from "../audio/types.js";

export type PlaybackPhase = "idle" | "fading-in" | "playing" | "fading-out";

export type PlaybackControllerOptions = {
  backend: AudioBackend;
  soundPath?: string;
  volume?: number;
  fadeInMs?: number;
  fadeOutMs?: number;
};

/**
 * Refcount-driven playback state machine (PC-105 / FR-05 / RR-05):
 * `idle → fading-in → playing → fading-out → idle`,
 * with `fading-out + start ⇒ cancel fade, resume`.
 */
export class PlaybackController {
  private readonly backend: AudioBackend;
  private soundPath: string;
  private volume: number;
  private fadeInMs: number;
  private fadeOutMs: number;
  private phase: PlaybackPhase = "idle";
  private handle: PlayerHandle | null = null;
  private stopChain: Promise<void> = Promise.resolve();
  private playChain: Promise<void> = Promise.resolve();
  /** Bumped to cancel an in-flight {@link ensurePlaying}. */
  private playEpoch = 0;

  constructor(options: PlaybackControllerOptions) {
    this.backend = options.backend;
    this.soundPath = options.soundPath ?? "fake://sleepy";
    this.volume = options.volume ?? 50;
    this.fadeInMs = options.fadeInMs ?? 0;
    this.fadeOutMs = options.fadeOutMs ?? 100;
  }

  getPhase(): PlaybackPhase {
    return this.phase;
  }

  /** Hot-reload fade/volume/sound from config (PC-204). */
  applySettings(settings: {
    volume?: number;
    fadeInMs?: number;
    fadeOutMs?: number;
    soundPath?: string;
  }): void {
    if (settings.volume !== undefined) this.volume = settings.volume;
    if (settings.fadeInMs !== undefined) this.fadeInMs = settings.fadeInMs;
    if (settings.fadeOutMs !== undefined) this.fadeOutMs = settings.fadeOutMs;
    if (settings.soundPath !== undefined) this.soundPath = settings.soundPath;
  }

  /**
   * Apply a new active-session count. Call after registry mutations.
   */
  async onActiveCount(activeCount: number): Promise<void> {
    if (activeCount > 0) {
      // Player-crash recovery (PC-206): if the handle died while we still
      // believe we're playing, drop to idle so ensurePlaying respawns.
      if (this.phase === "playing" && this.handle === null) {
        this.phase = "idle";
      }
      await this.ensurePlaying();
      return;
    }
    await this.ensureStopped();
  }

  /**
   * Mark the current player handle lost (backend crash / process exit).
   * Next {@link onActiveCount} with count &gt; 0 will respawn.
   */
  invalidateHandle(): void {
    this.handle = null;
    if (this.phase === "playing" || this.phase === "fading-in") {
      this.playEpoch++;
      this.phase = "idle";
    }
  }

  private async ensurePlaying(): Promise<void> {
    if (this.phase === "playing") return;
    if (this.phase === "fading-in") {
      await this.playChain;
      return;
    }
    // fading-out → play cancels fade inside FakeAudioBackend (and real adapters later)
    const epoch = ++this.playEpoch;
    this.phase = "fading-in";
    this.playChain = (async () => {
      try {
        const handle = await this.backend.play({
          soundPath: this.soundPath,
          volume: this.volume,
          fadeInMs: this.fadeInMs,
        });
        if (epoch !== this.playEpoch || this.phase !== "fading-in") {
          // Stop raced us — tear down the handle we just started.
          try {
            await this.backend.stop(handle, 0);
          } catch {
            // ignore
          }
          return;
        }
        this.handle = handle;
        this.phase = "playing";
      } catch {
        if (epoch === this.playEpoch && this.phase === "fading-in") {
          this.phase = "idle";
          this.handle = null;
        }
      }
    })();
    await this.playChain;
  }

  private async ensureStopped(): Promise<void> {
    if (this.phase === "idle") return;
    if (this.phase === "fading-out") {
      await this.stopChain;
      return;
    }
    if (this.phase === "fading-in") {
      // Cancel in-flight play; ensurePlaying tears down the handle if play completes late.
      this.playEpoch++;
      this.phase = "idle";
      this.handle = null;
      await this.playChain;
      return;
    }
    const handle = this.handle;
    if (!handle) {
      this.phase = "idle";
      return;
    }
    this.phase = "fading-out";
    // Fire-and-forget so a serialized control-pipe `start` can arrive mid-fade
    // and cancel (PC-105 / PC-109 fade-cancel). Callers that need completion
    // await via a subsequent onActiveCount(0) while already fading-out.
    this.stopChain = this.backend
      .stop(handle, this.fadeOutMs)
      .catch(() => undefined)
      .then(() => {
        if (this.handle?.id === handle.id && this.phase === "fading-out") {
          this.phase = "idle";
          this.handle = null;
        }
      });
  }
}
