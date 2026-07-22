#!/usr/bin/env node
/**
 * Hook entrypoint: `node dist/hook.js <start|stop|failure|session-end>`
 * Invisibility invariant: exit 0, zero bytes on stdout/stderr (PC-107 / RR-02).
 */
import { runHook } from "./hook/runHook.js";
import { EVENTS, type HookEventName } from "./hook/parse.js";

async function main(): Promise<void> {
  const eventArg = process.argv[2] ?? "";
  if (!EVENTS.has(eventArg)) {
    // Unknown argv: no-op (do not invent a stop).
    return;
  }
  const event = eventArg as HookEventName;

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk as Uint8Array));
  }
  const stdin = Buffer.concat(chunks);

  await runHook({ event, stdin });
}

main()
  .catch(() => undefined)
  .finally(() => {
    process.exit(0);
  });
