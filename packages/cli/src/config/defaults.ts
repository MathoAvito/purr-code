/** FR-06 defaults + schemaVersion (PC-204). */
export const CONFIG_SCHEMA_VERSION = 1 as const;

export type PurrCodeConfig = {
  schemaVersion: typeof CONFIG_SCHEMA_VERSION;
  enabled: boolean;
  sound: string;
  volume: number;
  fadeInMs: number;
  fadeOutMs: number;
  /**
   * Seconds a session may go without *any* hook event before its turn is
   * treated as abandoned and playback is released (fades out). Reset by every
   * event, including the `PreToolUse`/`PostToolUse` heartbeats. This is the
   * only stop signal for an Esc-interrupted turn: Claude Code fires no event
   * when the user aborts while the process stays alive (ADR 0001 / ADR 0008).
   */
  abandonedTurnSeconds: number;
  staleSessionMinutes: number;
  /** Unknown keys preserved across rewrite (forward-compat). */
  [key: string]: unknown;
};

export const DEFAULT_CONFIG: Readonly<PurrCodeConfig> = Object.freeze({
  schemaVersion: CONFIG_SCHEMA_VERSION,
  enabled: true,
  sound: "sleepy",
  volume: 60,
  fadeInMs: 400,
  fadeOutMs: 600,
  abandonedTurnSeconds: 90,
  staleSessionMinutes: 10,
});
