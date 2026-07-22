/** Control-pipe protocol (PC-103). Newline-delimited JSON, versioned. */

export const PROTOCOL_VERSION = 1 as const;

/** Max bytes for a single NDJSON line (untrusted input — §13). */
export const MAX_MESSAGE_BYTES = 64 * 1024;

export const FIRE_AND_FORGET_OPS = ["start", "stop", "failure", "session-end"] as const;
export const REQUEST_OPS = ["status", "volume", "preview", "set-config", "shutdown"] as const;
export const ALL_OPS = [...FIRE_AND_FORGET_OPS, ...REQUEST_OPS] as const;

export type FireAndForgetOp = (typeof FIRE_AND_FORGET_OPS)[number];
export type RequestOp = (typeof REQUEST_OPS)[number];
export type ControlOp = (typeof ALL_OPS)[number];

export type ControlMessageBase = {
  v: typeof PROTOCOL_VERSION;
  op: ControlOp;
};

export type StartMessage = ControlMessageBase & {
  op: "start";
  sessionId: string;
  claudePid?: number;
  /** Process identity token (Linux starttime / macOS lstart) — opaque string. */
  starttime?: string;
};

export type SessionScopedMessage = ControlMessageBase & {
  op: "stop" | "failure" | "session-end";
  sessionId: string;
};

export type StatusMessage = ControlMessageBase & { op: "status"; id: string };
export type VolumeMessage = ControlMessageBase & {
  op: "volume";
  id: string;
  value: number;
};
export type PreviewMessage = ControlMessageBase & {
  op: "preview";
  id: string;
  sound?: string;
  /** How long the daemon should play before auto-stop (ms). */
  durationMs?: number;
};
export type SetConfigMessage = ControlMessageBase & {
  op: "set-config";
  id: string;
  config: Record<string, unknown>;
};
export type ShutdownMessage = ControlMessageBase & { op: "shutdown"; id: string };

export type ControlRequest =
  | StartMessage
  | SessionScopedMessage
  | StatusMessage
  | VolumeMessage
  | PreviewMessage
  | SetConfigMessage
  | ShutdownMessage;

export type ControlResponse = {
  v: typeof PROTOCOL_VERSION;
  id?: string | undefined;
  ok: boolean;
  error?: string | undefined;
  result?: unknown;
};

export type ParseFailure = {
  ok: false;
  error: "too-large" | "invalid-json" | "invalid-schema";
  detail: string;
  /** Present when the line had a request id we can NACK. */
  id?: string;
};

export type ParseSuccess = { ok: true; message: ControlRequest };

export type ParseResult = ParseSuccess | ParseFailure;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= 512 ? value : undefined;
}

function asRequestId(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= 128 ? value : undefined;
}

/**
 * Parse one NDJSON line from an untrusted peer. Never throws.
 */
export function parseControlMessage(line: string | Buffer): ParseResult {
  const bytes = typeof line === "string" ? Buffer.byteLength(line, "utf8") : line.byteLength;
  if (bytes > MAX_MESSAGE_BYTES) {
    return { ok: false, error: "too-large", detail: `message exceeds ${MAX_MESSAGE_BYTES} bytes` };
  }

  const text = typeof line === "string" ? line : line.toString("utf8");
  if (text.length === 0) {
    return { ok: false, error: "invalid-json", detail: "empty line" };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, error: "invalid-json", detail: "JSON parse failed" };
  }

  if (!isPlainObject(raw)) {
    return { ok: false, error: "invalid-schema", detail: "message must be an object" };
  }

  const id = asRequestId(raw.id);
  if (raw.v !== PROTOCOL_VERSION) {
    return {
      ok: false,
      error: "invalid-schema",
      detail: `unsupported protocol version: ${String(raw.v)}`,
      ...(id !== undefined ? { id } : {}),
    };
  }

  const op = raw.op;
  if (typeof op !== "string" || !(ALL_OPS as readonly string[]).includes(op)) {
    return {
      ok: false,
      error: "invalid-schema",
      detail: `unknown op: ${String(op)}`,
      ...(id !== undefined ? { id } : {}),
    };
  }

  try {
    const message = validateOp(op as ControlOp, raw, id);
    return { ok: true, message };
  } catch (err) {
    return {
      ok: false,
      error: "invalid-schema",
      detail: err instanceof Error ? err.message : "schema validation failed",
      ...(id !== undefined ? { id } : {}),
    };
  }
}

function validateOp(
  op: ControlOp,
  raw: Record<string, unknown>,
  id: string | undefined,
): ControlRequest {
  switch (op) {
    case "start": {
      const sessionId = asNonEmptyString(raw.sessionId);
      if (!sessionId) throw new Error("start requires sessionId");
      const msg: StartMessage = { v: PROTOCOL_VERSION, op: "start", sessionId };
      if (
        typeof raw.claudePid === "number" &&
        Number.isInteger(raw.claudePid) &&
        raw.claudePid > 0
      ) {
        msg.claudePid = raw.claudePid;
      }
      if (typeof raw.starttime === "string" && raw.starttime.length <= 256) {
        msg.starttime = raw.starttime;
      }
      return msg;
    }
    case "stop":
    case "failure":
    case "session-end": {
      const sessionId = asNonEmptyString(raw.sessionId);
      if (!sessionId) throw new Error(`${op} requires sessionId`);
      return { v: PROTOCOL_VERSION, op, sessionId };
    }
    case "status":
    case "shutdown": {
      if (!id) throw new Error(`${op} requires id`);
      return { v: PROTOCOL_VERSION, op, id };
    }
    case "volume": {
      if (!id) throw new Error("volume requires id");
      if (typeof raw.value !== "number" || !Number.isFinite(raw.value)) {
        throw new Error("volume requires numeric value");
      }
      if (raw.value < 0 || raw.value > 100) throw new Error("volume value must be 0–100");
      return { v: PROTOCOL_VERSION, op: "volume", id, value: raw.value };
    }
    case "preview": {
      if (!id) throw new Error("preview requires id");
      const msg: PreviewMessage = { v: PROTOCOL_VERSION, op: "preview", id };
      const sound = asNonEmptyString(raw.sound);
      if (sound) msg.sound = sound;
      if (raw.durationMs !== undefined) {
        if (typeof raw.durationMs !== "number" || !Number.isFinite(raw.durationMs)) {
          throw new Error("preview durationMs must be a number");
        }
        if (raw.durationMs < 100 || raw.durationMs > 120_000) {
          throw new Error("preview durationMs must be 100–120000");
        }
        msg.durationMs = Math.floor(raw.durationMs);
      }
      return msg;
    }
    case "set-config": {
      if (!id) throw new Error("set-config requires id");
      if (!isPlainObject(raw.config)) throw new Error("set-config requires config object");
      return { v: PROTOCOL_VERSION, op: "set-config", id, config: raw.config };
    }
    default: {
      const _exhaustive: never = op;
      throw new Error(`unhandled op: ${String(_exhaustive)}`);
    }
  }
}

export function encodeControlMessage(message: ControlRequest | ControlResponse): string {
  return JSON.stringify(message) + "\n";
}

export function isFireAndForget(op: ControlOp): op is FireAndForgetOp {
  return (FIRE_AND_FORGET_OPS as readonly string[]).includes(op);
}

export function isRequestOp(op: ControlOp): op is RequestOp {
  return (REQUEST_OPS as readonly string[]).includes(op);
}
