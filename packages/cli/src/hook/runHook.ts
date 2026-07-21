import { PROTOCOL_VERSION, type ControlRequest } from "../control/protocol.js";
import { ensureDaemonRunning } from "../daemon/spawn.js";
import { debugLog } from "../log/debug.js";
import {
  parseHookStdin,
  readStarttimeToken,
  shouldSuppressHooks,
  type HookEventName,
} from "./parse.js";

export type RunHookOptions = {
  event: HookEventName;
  stdin: string | Buffer;
  env?: NodeJS.ProcessEnv;
  /** Injected for tests. */
  send?: (message: ControlRequest) => Promise<void>;
  ensureDaemon?: typeof ensureDaemonRunning;
  now?: () => number;
};

/**
 * Hook adapter core (PC-107). Always resolves; never writes stdout/stderr.
 * Callers must `process.exit(0)` after await.
 */
export async function runHook(options: RunHookOptions): Promise<void> {
  const env = options.env ?? process.env;
  try {
    if (shouldSuppressHooks(env)) {
      debugLog({ event: options.event, detail: "suppressed" }, { env });
      return;
    }

    const parsed = parseHookStdin(options.stdin, options.event);
    if (!parsed.ok) {
      debugLog({ event: options.event, detail: parsed.error }, { env });
      return;
    }

    const { sessionId } = parsed.payload;
    const message = buildMessage(options.event, sessionId);

    if (options.send) {
      await options.send(message);
    } else {
      const ensure = options.ensureDaemon ?? ensureDaemonRunning;
      let client: Awaited<ReturnType<typeof ensureDaemonRunning>>["client"] | undefined;
      try {
        const ensured = await ensure({ env });
        client = ensured.client;
        // Hold the FR-05 connection through the first message, then flush+close.
        await client.send(message);
      } catch (err) {
        debugLog(
          {
            event: options.event,
            sessionId,
            detail: client ? "daemon-unreachable" : "daemon-spawn-failed",
            error: err instanceof Error ? err.message : "send failed",
          },
          { env },
        );
        return;
      } finally {
        client?.close();
      }
    }

    debugLog({ event: options.event, sessionId, detail: "sent" }, { env });
  } catch (err) {
    debugLog(
      {
        event: options.event,
        detail: "hook-catch-all",
        error: err instanceof Error ? err.message : "unknown",
      },
      { env },
    );
  }
}

function buildMessage(event: HookEventName, sessionId: string): ControlRequest {
  if (event === "start") {
    const claudePid = process.ppid;
    const starttime = readStarttimeToken(claudePid);
    return {
      v: PROTOCOL_VERSION,
      op: "start",
      sessionId,
      claudePid,
      ...(starttime !== undefined ? { starttime } : {}),
    };
  }
  return { v: PROTOCOL_VERSION, op: event, sessionId };
}
