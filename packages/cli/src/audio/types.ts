/**
 * Shared audio-backend contracts (PRD §11.3).
 *
 * Each real adapter owns perceptual→amplitude mapping (FR-06 / PC-205).
 * The fake backend records the perceptual volume it was given.
 */

/** Opaque handle returned by `play`; required by `setVolume` / `stop`. */
export type PlayerHandle = {
  readonly id: string;
};

export type BackendTier = "fake" | "sidecar" | "mpv" | "native" | "none";

export type BackendCapabilities = {
  available: boolean;
  tier: BackendTier;
  name: string;
  loop: boolean;
  fade: boolean;
  runtimeVolume: boolean;
};

export type PlaybackOptions = {
  /** Absolute or relative path to the sound asset (not read by the fake backend). */
  soundPath: string;
  /** Perceptual volume 0–100 (FR-06). */
  volume: number;
  /** Fade-in duration in ms; recorded for assertions, not timed by the fake backend. */
  fadeInMs?: number;
};

/**
 * Tiered audio backend. `setVolume` is optional in the PRD because tier-3
 * cannot change volume at runtime; tier-1/fake/mpv implement it.
 *
 * `onHandleLost` is optional but required for PC-206 player-crash recovery:
 * real adapters (sidecar/mpv) should fire it when the player child exits
 * unexpectedly; the fake backend fires it from its `crash()` helper.
 */
export interface AudioBackend {
  detect(): Promise<BackendCapabilities>;
  play(options: PlaybackOptions): Promise<PlayerHandle>;
  setVolume?(handle: PlayerHandle, volume: number): Promise<void>;
  stop(handle: PlayerHandle, fadeOutMs: number): Promise<void>;
  /**
   * Subscribe to unexpected handle death. Returns an unsubscribe function.
   * Must not throw; listeners should be fail-open.
   */
  onHandleLost?(listener: (handle: PlayerHandle) => void): () => void;
}
