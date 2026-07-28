import { CONFIG_SCHEMA_VERSION, DEFAULT_CONFIG, type PurrCodeConfig } from "./defaults.js";

/**
 * Parse raw JSON into a config object. Invalid fields fall back to defaults
 * (never throw). Unknown keys are preserved for forward-compat rewrite.
 */
export function normalizeConfig(raw: unknown): PurrCodeConfig {
  const base: Record<string, unknown> =
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? { ...(raw as Record<string, unknown>) }
      : {};

  const enabled = asBoolean(base.enabled) ?? DEFAULT_CONFIG.enabled;
  const sound = asSoundName(base.sound) ?? DEFAULT_CONFIG.sound;
  const volume = asVolume(base.volume) ?? DEFAULT_CONFIG.volume;
  const fadeInMs = asNonNegInt(base.fadeInMs) ?? DEFAULT_CONFIG.fadeInMs;
  const fadeOutMs = asNonNegInt(base.fadeOutMs) ?? DEFAULT_CONFIG.fadeOutMs;
  const abandonedTurnSeconds =
    asAbandonedSeconds(base.abandonedTurnSeconds) ?? DEFAULT_CONFIG.abandonedTurnSeconds;
  const staleSessionMinutes =
    asPositiveInt(base.staleSessionMinutes) ?? DEFAULT_CONFIG.staleSessionMinutes;
  const schemaVersion =
    typeof base.schemaVersion === "number" && Number.isInteger(base.schemaVersion)
      ? base.schemaVersion
      : CONFIG_SCHEMA_VERSION;

  // Start from unknown keys, then overlay validated known fields.
  const out: PurrCodeConfig = {
    ...base,
    schemaVersion: schemaVersion as typeof CONFIG_SCHEMA_VERSION,
    enabled,
    sound,
    volume,
    fadeInMs,
    fadeOutMs,
    abandonedTurnSeconds,
    staleSessionMinutes,
  };
  // Always stamp current schema version on normalize (migration stub).
  out.schemaVersion = CONFIG_SCHEMA_VERSION;
  return out;
}

/** Merge a partial patch (e.g. set-config) onto an existing config. */
export function mergeConfig(
  current: PurrCodeConfig,
  patch: Record<string, unknown>,
): PurrCodeConfig {
  return normalizeConfig({ ...current, ...patch });
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asSoundName(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) return undefined;
  // Allowlist-ish: letters, digits, dash, underscore.
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) return undefined;
  return value;
}

function asVolume(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value < 0 || value > 100) return undefined;
  return Math.round(value);
}

function asNonNegInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (!Number.isInteger(value) || value < 0 || value > 3_600_000) return undefined;
  return value;
}

function asPositiveInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (!Number.isInteger(value) || value < 1 || value > 24 * 60) return undefined;
  return value;
}

/** Abandoned-turn timeout in seconds: 5 s … 24 h. */
function asAbandonedSeconds(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (!Number.isInteger(value) || value < 5 || value > 24 * 60 * 60) return undefined;
  return value;
}
