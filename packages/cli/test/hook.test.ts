import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runHook } from "../src/hook/runHook.js";
import { parseHookStdin, shouldSuppressHooks } from "../src/hook/parse.js";
import { debugLog, hashSessionId } from "../src/log/debug.js";
import { PROTOCOL_VERSION, type ControlRequest } from "../src/control/protocol.js";

describe("hook adapter (PC-107)", () => {
  it("parses session_id and rejects bad stdin", () => {
    expect(
      parseHookStdin(JSON.stringify({ session_id: "abc", hook_event_name: "Stop" }), "stop"),
    ).toEqual({
      ok: true,
      payload: { sessionId: "abc", rawEvent: "Stop" },
    });
    expect(parseHookStdin("{", "start").ok).toBe(false);
    expect(parseHookStdin("x".repeat(300_000), "start").ok).toBe(false);
  });

  it("suppresses CI / remote / sdk-cli", () => {
    expect(shouldSuppressHooks({ CI: "true" })).toBe(true);
    expect(shouldSuppressHooks({ CLAUDE_CODE_REMOTE: "true" })).toBe(true);
    expect(shouldSuppressHooks({ CLAUDE_CODE_ENTRYPOINT: "sdk-cli" })).toBe(true);
    expect(shouldSuppressHooks({})).toBe(false);
  });

  it("always completes with exit semantics and never throws; sends start with ppid", async () => {
    const sent: ControlRequest[] = [];
    await runHook({
      event: "start",
      stdin: JSON.stringify({ session_id: "s1" }),
      env: {},
      send: (m) => {
        sent.push(m);
        return Promise.resolve();
      },
    });
    expect(sent[0]).toMatchObject({
      v: PROTOCOL_VERSION,
      op: "start",
      sessionId: "s1",
      claudePid: process.ppid,
    });
  });

  it("fail-silent on malformed stdin, send failure, and spawn failure", async () => {
    await runHook({
      event: "stop",
      stdin: "not-json",
      env: {},
      send: () => Promise.reject(new Error("unreachable")),
    });
    await runHook({
      event: "stop",
      stdin: JSON.stringify({ session_id: "s" }),
      env: {},
      send: () => Promise.reject(new Error("daemon down")),
    });
    await runHook({
      event: "start",
      stdin: JSON.stringify({ session_id: "s" }),
      env: {},
      ensureDaemon: () => Promise.reject(new Error("spawn failed")),
    });
  });

  it("does nothing when suppressed", async () => {
    let called = false;
    await runHook({
      event: "start",
      stdin: JSON.stringify({ session_id: "s" }),
      env: { CI: "1" },
      send: () => {
        called = true;
        return Promise.resolve();
      },
    });
    expect(called).toBe(false);
  });
});

describe("debug log (PC-108)", () => {
  it("writes hashed session ids and strips forbidden fields", async () => {
    const dir = await mkdtemp(join(tmpdir(), "purrcode-log-"));
    const logPath = join(dir, "debug.log");
    try {
      debugLog(
        {
          event: "start",
          sessionId: "secret-session",
          prompt: "SHOULD_NOT_APPEAR",
          detail: "ok",
        },
        { env: { PURRCODE_LOG: "debug" }, logPath },
      );
      const body = await readFile(logPath, "utf8");
      expect(body).toContain(hashSessionId("secret-session"));
      expect(body).not.toContain("secret-session");
      expect(body).not.toContain("SHOULD_NOT_APPEAR");
      expect(body).not.toContain("prompt");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("is disabled by default", async () => {
    const dir = await mkdtemp(join(tmpdir(), "purrcode-log-off-"));
    const logPath = join(dir, "debug.log");
    try {
      debugLog({ event: "start", sessionId: "x" }, { env: {}, logPath });
      await expect(readFile(logPath, "utf8")).rejects.toBeTruthy();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
