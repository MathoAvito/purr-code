import { MAX_MESSAGE_BYTES } from "../control/protocol.js";

export { readStarttimeToken } from "../process/liveness.js";

export type HookEventName = "start" | "heartbeat" | "stop" | "failure" | "session-end";

export const EVENTS: ReadonlySet<string> = new Set([
  "start",
  "heartbeat",
  "stop",
  "failure",
  "session-end",
]);

export type HookPayload = {
  sessionId: string;
  rawEvent?: string;
};

export type ParseHookResult = { ok: true; payload: HookPayload } | { ok: false; error: string };

const MAX_STDIN = Math.min(MAX_MESSAGE_BYTES, 256 * 1024);

/**
 * Parse Claude Code hook stdin as untrusted input (PC-107).
 * Size-capped, schema-validated; never throw.
 */
export function parseHookStdin(input: string | Buffer, event: HookEventName): ParseHookResult {
  const bytes = typeof input === "string" ? Buffer.byteLength(input, "utf8") : input.byteLength;
  if (bytes > MAX_STDIN) {
    return { ok: false, error: "stdin too large" };
  }
  const text = (typeof input === "string" ? input : input.toString("utf8")).trim();
  if (!text) {
    return { ok: false, error: "empty stdin" };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, error: "invalid json" };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "stdin must be object" };
  }
  const obj = raw as Record<string, unknown>;
  const sessionId =
    (typeof obj.session_id === "string" && obj.session_id) ||
    (typeof obj.sessionId === "string" && obj.sessionId) ||
    "";
  if (!sessionId || sessionId.length > 128) {
    return { ok: false, error: "missing session_id" };
  }
  void event;
  return {
    ok: true,
    payload: {
      sessionId,
      ...(typeof obj.hook_event_name === "string" ? { rawEvent: obj.hook_event_name } : {}),
    },
  };
}

/** CI / remote / headless sdk-cli suppression (ADR 0001 / §16). */
export function shouldSuppressHooks(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.CI === "true" || env.CI === "1") return true;
  if (env.CLAUDE_CODE_REMOTE === "true") return true;
  if (env.CLAUDE_CODE_ENTRYPOINT === "sdk-cli") return true;
  return false;
}
