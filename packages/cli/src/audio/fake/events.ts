/**
 * Fake-audio JSONL event vocabulary (PC-101).
 *
 * Story names (`start`, `volume-change`, …) are the primary `type`.
 * `sidecar` mirrors the miniaudio PoC stdout events (ADR 0004) so later
 * integration tests exercise the same lifecycle shapes as PC-301.
 */

export const FAKE_AUDIO_EVENT_TYPES = [
  "ready",
  "start",
  "volume-change",
  "fade-start",
  "fade-cancel",
  "stop",
] as const;

export type FakeAudioEventType = (typeof FAKE_AUDIO_EVENT_TYPES)[number];

/** Sidecar stdout event names from the PC-004 PoC. */
export type SidecarEventName = "ready" | "loaded" | "playing" | "volume" | "fadeout" | "exiting";

type FakeAudioEventBase = {
  /** Unix epoch milliseconds. */
  ts: number;
  type: FakeAudioEventType;
  sidecar?: SidecarEventName;
  handleId?: string;
  /** Perceptual volume 0–100 when relevant. */
  volume?: number;
  soundPath?: string;
  fadeInMs?: number;
  fadeOutMs?: number;
};

export type FakeAudioEvent = FakeAudioEventBase;
