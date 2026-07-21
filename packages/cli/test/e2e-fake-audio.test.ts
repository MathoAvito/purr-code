/**
 * End-to-end integration suite v1 (PC-109) against the fake audio backend.
 * Run via `pnpm e2e:fake-audio` (sets PURRCODE_FAKE_AUDIO=1 in-process).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FakeAudioBackend,
  assertContainsSequence,
  readFakeAudioLog,
} from "../src/audio/fake/index.js";
import { ControlPipeClient } from "../src/control/client.js";
import { PROTOCOL_VERSION } from "../src/control/protocol.js";
import { Daemon } from "../src/daemon/Daemon.js";
import { ensureDaemonRunning } from "../src/daemon/spawn.js";
import { runHook } from "../src/hook/runHook.js";
import { shouldSuppressHooks } from "../src/hook/parse.js";
import { PlaybackController } from "../src/session/PlaybackController.js";
import { daemonIsolationOptions } from "./helpers/controlEndpoint.js";

process.env.PURRCODE_FAKE_AUDIO = "1";

describe("e2e fake-audio (PC-109)", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()?.();
  });

  async function sleep(ms: number): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
  }

  /** Poll fake-audio log until the lifecycle subsequence appears (avoids Windows timing flakes). */
  async function waitForLifecycle(
    logPath: string,
    expected: Array<"start" | "fade-start" | "fade-cancel" | "stop">,
    timeoutMs = 2000,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let last = "(empty)";
    while (Date.now() < deadline) {
      const events = await readFakeAudioLog(logPath);
      const relevant = events.filter((e) =>
        ["start", "fade-start", "fade-cancel", "stop"].includes(e.type),
      );
      last = relevant.map((e) => e.type).join(" → ") || "(empty)";
      try {
        assertContainsSequence(relevant, expected);
        return;
      } catch {
        await sleep(25);
      }
    }
    throw new Error(`Timed out waiting for [${expected.join(" → ")}]; last seen [${last}]`);
  }

  async function harness(options: { fadeOutMs?: number } = {}): Promise<{
    runtimeDir: string;
    logPath: string;
    daemon: Daemon;
    client: ControlPipeClient;
  }> {
    const runtimeDir = await mkdtemp(join(tmpdir(), "purrcode-e2e-"));
    cleanups.push(async () => rm(runtimeDir, { recursive: true, force: true }));
    const logPath = join(runtimeDir, "fake.jsonl");
    const audio = new FakeAudioBackend({ logPath, enabled: true });
    const fadeOutMs = options.fadeOutMs ?? 50;
    const playback = new PlaybackController({
      backend: audio,
      fadeOutMs,
      fadeInMs: 0,
    });
    const iso = daemonIsolationOptions(runtimeDir);
    const daemon = new Daemon({
      ...iso,
      idleMs: 60_000,
      audioBackend: audio,
      playback,
    });
    await daemon.start();
    cleanups.push(async () => daemon.shutdown());
    const client = new ControlPipeClient({ path: daemon.controlPath });
    cleanups.push(() => {
      client.close();
      return Promise.resolve();
    });
    return { runtimeDir, logPath, daemon, client };
  }

  it("start → stop fades out", async () => {
    const { client, logPath } = await harness();
    await client.send({ v: PROTOCOL_VERSION, op: "start", sessionId: "s1" });
    await client.send({ v: PROTOCOL_VERSION, op: "stop", sessionId: "s1" });
    await waitForLifecycle(logPath, ["start", "fade-start", "stop"]);
  });

  it("start → failure fades out", async () => {
    const { client, logPath } = await harness();
    await client.send({ v: PROTOCOL_VERSION, op: "start", sessionId: "s1" });
    await client.send({ v: PROTOCOL_VERSION, op: "failure", sessionId: "s1" });
    await waitForLifecycle(logPath, ["start", "fade-start", "stop"]);
  });

  it("start → session-end fades out", async () => {
    const { client, logPath } = await harness();
    await client.send({ v: PROTOCOL_VERSION, op: "start", sessionId: "s1" });
    await client.send({ v: PROTOCOL_VERSION, op: "session-end", sessionId: "s1" });
    await waitForLifecycle(logPath, ["start", "fade-start", "stop"]);
  });

  it("two sessions: one stop continues; final stop fades", async () => {
    const { client, daemon } = await harness();
    await client.send({ v: PROTOCOL_VERSION, op: "start", sessionId: "a" });
    await client.send({ v: PROTOCOL_VERSION, op: "start", sessionId: "b" });
    await sleep(40);
    await client.send({ v: PROTOCOL_VERSION, op: "stop", sessionId: "a" });
    await sleep(40);
    let status = await client.request({ v: PROTOCOL_VERSION, op: "status", id: "t1" });
    expect(status.result).toMatchObject({ sessions: 1, phase: "playing" });
    await client.send({ v: PROTOCOL_VERSION, op: "stop", sessionId: "b" });
    await sleep(100);
    status = await client.request({ v: PROTOCOL_VERSION, op: "status", id: "t2" });
    expect(status.result).toMatchObject({ sessions: 0, phase: "idle" });
    expect(daemon.sessionCount).toBe(0);
  });

  it("duplicate start is idempotent", async () => {
    const { client } = await harness();
    await client.send({ v: PROTOCOL_VERSION, op: "start", sessionId: "dup" });
    await client.send({ v: PROTOCOL_VERSION, op: "start", sessionId: "dup" });
    await sleep(30);
    const status = await client.request({ v: PROTOCOL_VERSION, op: "status", id: "d" });
    expect(status.result).toMatchObject({ sessions: 1, phase: "playing" });
  });

  it("start during fade-out emits fade-cancel", async () => {
    const { client, logPath } = await harness({ fadeOutMs: 200 });
    await client.send({ v: PROTOCOL_VERSION, op: "start", sessionId: "x" });
    await sleep(20);
    await client.send({ v: PROTOCOL_VERSION, op: "stop", sessionId: "x" });
    await client.send({ v: PROTOCOL_VERSION, op: "start", sessionId: "x" });
    await sleep(40);
    await client.send({ v: PROTOCOL_VERSION, op: "stop", sessionId: "x" });
    await sleep(250);

    const events = await readFakeAudioLog(logPath);
    assertContainsSequence(
      events.filter((e) => ["start", "fade-start", "fade-cancel", "stop"].includes(e.type)),
      ["start", "fade-start", "fade-cancel", "start", "fade-start", "stop"],
    );
  });

  it("daemon-spawn race: bind mutex; live socket skips spawn", async () => {
    const runtimeDir = await mkdtemp(join(tmpdir(), "purrcode-e2e-race-"));
    cleanups.push(async () => rm(runtimeDir, { recursive: true, force: true }));
    const iso = daemonIsolationOptions(runtimeDir);

    const a = new Daemon({ ...iso, idleMs: 60_000 });
    expect(await a.start()).toEqual({ status: "listening" });
    cleanups.push(async () => a.shutdown());

    const b = new Daemon({ ...iso, idleMs: 60_000 });
    expect(await b.start()).toEqual({ status: "lost-race" });

    const spawnImpl = vi.fn(() => {
      const child = { unref: vi.fn(), pid: 9999 } as unknown as ChildProcess;
      return child;
    });
    const result = await ensureDaemonRunning({
      ...iso,
      spawnImpl: spawnImpl as unknown as typeof import("node:child_process").spawn,
      connectTimeoutMs: 2000,
    });
    expect(result.status).toBe("already-running");
    expect(spawnImpl).not.toHaveBeenCalled();
    result.client.close();
  });

  it("cold-boot idle-exit guard: open connection blocks idle exit", async () => {
    const runtimeDir = await mkdtemp(join(tmpdir(), "purrcode-e2e-idle-"));
    cleanups.push(async () => rm(runtimeDir, { recursive: true, force: true }));
    const iso = daemonIsolationOptions(runtimeDir);
    let exited = false;
    const daemon = new Daemon({
      ...iso,
      idleMs: 80,
      onIdleExit: () => {
        exited = true;
      },
    });
    await daemon.start();
    cleanups.push(async () => daemon.shutdown());
    const client = new ControlPipeClient({ path: daemon.controlPath });
    await client.ensureConnected();
    cleanups.push(() => {
      client.close();
      return Promise.resolve();
    });
    await sleep(200);
    expect(exited).toBe(false);
    client.close();
    await sleep(250);
    expect(exited).toBe(true);
  });

  it("abandoned-turn: dead owner is reconciled away with no stop (PC-202/203)", async () => {
    const { client, daemon } = await harness();
    await client.send({
      v: PROTOCOL_VERSION,
      op: "start",
      sessionId: "abandoned",
      claudePid: 1_999_999_999,
      starttime: "ghost",
    });
    // Event-driven reconcile drops the dead owner before playback sticks.
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && daemon.sessionCount > 0) {
      await sleep(20);
    }
    expect(daemon.sessionCount).toBe(0);
    const status = await client.request({ v: PROTOCOL_VERSION, op: "status", id: "ab" });
    expect(status.result).toMatchObject({ sessions: 0, phase: "idle" });
  });

  it("sdk-cli / CI suppression: hook does nothing", async () => {
    expect(shouldSuppressHooks({ CLAUDE_CODE_ENTRYPOINT: "sdk-cli" })).toBe(true);
    let sent = false;
    await runHook({
      event: "start",
      stdin: JSON.stringify({ session_id: "headless" }),
      env: { CLAUDE_CODE_ENTRYPOINT: "sdk-cli" },
      send: () => {
        sent = true;
        return Promise.resolve();
      },
    });
    expect(sent).toBe(false);
  });

  it("hook adapter drives daemon start/stop via injected send", async () => {
    const { client, logPath, daemon } = await harness();
    await runHook({
      event: "start",
      stdin: JSON.stringify({ session_id: "hook-s" }),
      env: {},
      send: async (msg) => {
        await client.send(msg);
      },
    });
    await sleep(40);
    expect(daemon.sessionCount).toBe(1);
    await runHook({
      event: "stop",
      stdin: JSON.stringify({ session_id: "hook-s" }),
      env: {},
      send: async (msg) => {
        await client.send(msg);
      },
    });
    await sleep(100);
    expect(daemon.sessionCount).toBe(0);
    const events = await readFakeAudioLog(logPath);
    assertContainsSequence(
      events.filter((e) => ["start", "fade-start", "stop"].includes(e.type)),
      ["start", "fade-start", "stop"],
    );
  });
});
