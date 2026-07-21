import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export const PURRCODE_LOG_ENV = "PURRCODE_LOG";

export type DebugLogFields = {
  event?: string;
  sessionId?: string;
  pid?: number;
  detail?: string;
  [key: string]: unknown;
};

const FORBIDDEN_KEYS = new Set([
  "prompt",
  "message",
  "content",
  "transcript",
  "tool_input",
  "stdin",
  "env",
  "password",
  "token",
  "api_key",
  "authorization",
]);

/** Hash session IDs before logging (never store raw). */
export function hashSessionId(sessionId: string): string {
  return createHash("sha256").update(sessionId).digest("hex").slice(0, 16);
}

export function isDebugLogEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[PURRCODE_LOG_ENV] === "debug";
}

export function defaultDebugLogPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.PURRCODE_LOG_FILE) return env.PURRCODE_LOG_FILE;
  return join(homedir(), ".local", "state", "purrcode", "debug.log");
}

/**
 * Opt-in file logger (PC-108). Never writes to stdout/stderr.
 * Strips forbidden keys; hashes session IDs.
 */
export function debugLog(
  fields: DebugLogFields,
  options: { env?: NodeJS.ProcessEnv; logPath?: string; now?: () => number } = {},
): void {
  const env = options.env ?? process.env;
  if (!isDebugLogEnabled(env)) return;

  const safe: Record<string, unknown> = { ts: (options.now ?? Date.now)() };
  for (const [key, value] of Object.entries(fields)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) continue;
    if (key === "sessionId" && typeof value === "string") {
      safe.sessionIdHash = hashSessionId(value);
      continue;
    }
    if (typeof value === "string" && value.length > 500) continue;
    safe[key] = value;
  }

  const path = options.logPath ?? defaultDebugLogPath(env);
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(safe)}\n`, { encoding: "utf8" });
  } catch {
    // fail-silent: logging must never break hook paths
  }
}
