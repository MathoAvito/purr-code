/** FR-06 defaults + schemaVersion (PC-204). */
export const CONFIG_SCHEMA_VERSION = 1 as const;

export type PurrCodeConfig = {
  schemaVersion: typeof CONFIG_SCHEMA_VERSION;
  enabled: boolean;
  sound: string;
  volume: number;
  fadeInMs: number;
  fadeOutMs: number;
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
  staleSessionMinutes: 10,
});
