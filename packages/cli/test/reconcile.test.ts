/**
 * Stale TTL & event-driven reconciliation (PC-203).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  FakeAudioBackend,
  assertContainsSequence,
  readFakeAudioLog,
} from "../src/audio/fake/index.js";
import { ControlPipeClient } from "../src/control/client.js";
import { PROTOCOL_VERSION } from "../src/control/protocol.js";
import { Daemon } from "../src/daemon/Daemon.js";
import { reconcileRegistry } from "../src/daemon/reconcile.js";
import { PlaybackController } from "../src/session/PlaybackController.js";
import { SessionRegistry } from "../src/session/SessionRegistry.js";
import { writeRegistrySnapshot } from "../src/session/snapshot.js";
import { daemonIsolationOptions } from "./helpers/controlEndpoint.js";

process.env.PURRCODE_FAKE_AUDIO = "1";

describe("reconcileRegistry (PC-203)", () => {
  it("GCs sessions past staleSessionMs and still applies liveness", async () => {
    const now = 10_000;
    const reg = new SessionRegistry({ now: () => now });
    reg.start({ sessionId: "fresh", claudePid: 1, starttime: "a" });
    reg.start({ sessionId: "stale", claudePid: 2, starttime: "b" });
    // Age only the stale session's lastSeenAt.
    const stale = reg.get("stale")!;
    stale.lastSeenAt = 0;

    const result = await reconcileRegistry(reg, {
      now: () => now,
      staleSessionMs: 1000,
      platform: "linux",
      classify: (id) => (id.pid === 1 ? "running" : "running"),
    });

    expect(result.staleRemoved).toEqual(["stale"]);
    expect(reg.get("stale")).toBeUndefined();
    expect(reg.get("fresh")).toBeDefined();

    // Liveness: kill fresh on next pass.
    const dead = await reconcileRegistry(reg, {
      now: () => now,
      staleSessionMs: 1000,
      platform: "linux",
      classify: () => "dead",
    });
    expect(dead.removed).toEqual(["fresh"]);
    expect(reg.size).toBe(0);
  });
});

describe("reconcileRegistry abandoned-turn release (ADR 0008)", () => {
  it("idles a live session past abandonedTurnMs but keeps the record", async () => {
    const now = 100_000;
    const reg = new SessionRegistry({ now: () => now });
    reg.start({ sessionId: "abandoned" });
    reg.start({ sessionId: "fresh" });
    reg.get("abandoned")!.lastSeenAt = now - 91_000; // no event for 91s

    const result = await reconcileRegistry(reg, {
      now: () => now,
      // Long stale TTL so only the abandoned-turn timeout fires here.
      staleSessionMs: 600_000,
      abandonedTurnMs: 90_000,
      platform: "linux",
    });

    expect(result.idled).toEqual(["abandoned"]);
    expect(result.staleRemoved).toEqual([]);
    // Record is kept for later resurrection; only playback drops.
    expect(reg.get("abandoned")).toBeDefined();
    expect(reg.get("abandoned")!.idle).toBe(true);
    expect(reg.playbackCount()).toBe(1);

    // Idempotent: a second pass does not re-report the same idle session.
    const again = await reconcileRegistry(reg, {
      now: () => now,
      staleSessionMs: 600_000,
      abandonedTurnMs: 90_000,
      platform: "linux",
    });
    expect(again.idled).toEqual([]);
  });

  it("does not idle a suspended session (owned by the watchdog + stale TTL)", async () => {
    const now = 100_000;
    const reg = new SessionRegistry({ now: () => now });
    reg.start({ sessionId: "suspended" });
    reg.setPaused("suspended", true);
    reg.get("suspended")!.lastSeenAt = now - 91_000;

    const result = await reconcileRegistry(reg, {
      now: () => now,
      staleSessionMs: 600_000,
      abandonedTurnMs: 90_000,
      platform: "linux",
    });

    expect(result.idled).toEqual([]);
    expect(reg.get("suspended")!.idle).toBeUndefined();
  });

  it("a heartbeat before the timeout keeps a session out of idle", async () => {
    let now = 100_000;
    const reg = new SessionRegistry({ now: () => now });
    reg.start({ sessionId: "busy" });

    // Heartbeat at +60s refreshes lastSeenAt.
    now = 160_000;
    reg.touch("busy");

    // At +120s from start (but only +60s from the heartbeat) it is still fresh.
    now = 220_000;
    const result = await reconcileRegistry(reg, {
      now: () => now,
      staleSessionMs: 600_000,
      abandonedTurnMs: 90_000,
      platform: "linux",
    });
    expect(result.idled).toEqual([]);
    expect(reg.playbackCount()).toBe(1);
  });
});

describe("Daemon reconciliation (PC-203)", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length) {
      try {
        await cleanups.pop()?.();
      } catch {
        /* ignore cleanup races */
      }
    }
  });

  async function sleep(ms: number): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
  }

  async function waitForLifecycle(
    logPath: string,
    expected: Array<"start" | "fade-start" | "fade-cancel" | "stop">,
    timeoutMs = 3000,
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

  it("stale session is GC'd on the next unrelated event", async () => {
    const runtimeDir = await mkdtemp(join(tmpdir(), "purrcode-ttl-evt-"));
    cleanups.push(async () => rm(runtimeDir, { recursive: true, force: true }));
    const logPath = join(runtimeDir, "fake.jsonl");
    const audio = new FakeAudioBackend({ logPath, enabled: true });
    const playback = new PlaybackController({ backend: audio, fadeOutMs: 50, fadeInMs: 0 });
    const iso = daemonIsolationOptions(runtimeDir);

    // Controllable clock: starts at T=1000.
    let now = 1000;
    const daemon = new Daemon({
      ...iso,
      idleMs: 60_000,
      audioBackend: audio,
      playback,
      watchdogIntervalMs: 0,
      staleSessionMs: 500,
      now: () => now,
      // No PIDs in this test — liveness skipped; TTL only.
      // Do not override Daemon.platform — that forces UDS on Windows CI.
      watchdogClassify: () => "running",
    });
    await daemon.start();
    cleanups.push(async () => daemon.shutdown());
    const client = new ControlPipeClient({ path: daemon.controlPath });
    cleanups.push(() => {
      client.close();
      return Promise.resolve();
    });

    await client.send({ v: PROTOCOL_VERSION, op: "start", sessionId: "old" });
    await waitForLifecycle(logPath, ["start"], 2000);
    expect(daemon.sessionCount).toBe(1);

    // Advance past TTL without any events for "old".
    now = 2000;

    // Unrelated event on a different session triggers full-registry reconcile.
    await client.send({ v: PROTOCOL_VERSION, op: "start", sessionId: "new" });
    // send() is fire-and-forget — wait until the handler finishes reconcile.
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      if (
        daemon.getSessionRegistry().get("old") === undefined &&
        daemon.getSessionRegistry().get("new") !== undefined
      ) {
        break;
      }
      await sleep(10);
    }
    expect(daemon.getSessionRegistry().get("old")).toBeUndefined();
    expect(daemon.getSessionRegistry().get("new")).toBeDefined();
    // Still purring — "new" is active.
    expect(daemon.getSessionRegistry().playbackCount()).toBe(1);
    const events = await readFakeAudioLog(logPath);
    expect(events.some((e) => e.type === "fade-start")).toBe(false);
  });

  it("TTL expiry alone (watchdog tick) stops playback", async () => {
    const runtimeDir = await mkdtemp(join(tmpdir(), "purrcode-ttl-tick-"));
    cleanups.push(async () => rm(runtimeDir, { recursive: true, force: true }));
    const logPath = join(runtimeDir, "fake.jsonl");
    const audio = new FakeAudioBackend({ logPath, enabled: true });
    const playback = new PlaybackController({ backend: audio, fadeOutMs: 50, fadeInMs: 0 });
    const iso = daemonIsolationOptions(runtimeDir);

    let now = 1000;
    const daemon = new Daemon({
      ...iso,
      idleMs: 60_000,
      audioBackend: audio,
      playback,
      watchdogIntervalMs: 0,
      staleSessionMs: 500,
      now: () => now,
      watchdogClassify: () => "running",
    });
    await daemon.start();
    cleanups.push(async () => daemon.shutdown());
    const client = new ControlPipeClient({ path: daemon.controlPath });
    cleanups.push(() => {
      client.close();
      return Promise.resolve();
    });

    await client.send({ v: PROTOCOL_VERSION, op: "start", sessionId: "lonely" });
    await waitForLifecycle(logPath, ["start"], 2000);

    now = 2000; // past TTL — no further control messages
    await daemon.runWatchdogOnce();
    await waitForLifecycle(logPath, ["start", "fade-start"], 2000);
    expect(daemon.sessionCount).toBe(0);
  });

  it("abandoned turn (Esc) fades out via the watchdog, and a heartbeat resumes it", async () => {
    const runtimeDir = await mkdtemp(join(tmpdir(), "purrcode-abandoned-"));
    cleanups.push(async () => rm(runtimeDir, { recursive: true, force: true }));
    const logPath = join(runtimeDir, "fake.jsonl");
    const audio = new FakeAudioBackend({ logPath, enabled: true });
    const playback = new PlaybackController({ backend: audio, fadeOutMs: 50, fadeInMs: 0 });
    const iso = daemonIsolationOptions(runtimeDir);

    let now = 1000;
    const daemon = new Daemon({
      ...iso,
      idleMs: 60_000,
      audioBackend: audio,
      playback,
      watchdogIntervalMs: 0,
      // Stale GC far away so the abandoned-turn timeout is what fires.
      staleSessionMs: 600_000,
      abandonedTurnMs: 5_000,
      now: () => now,
      watchdogClassify: () => "running",
    });
    await daemon.start();
    cleanups.push(async () => daemon.shutdown());
    const client = new ControlPipeClient({ path: daemon.controlPath });
    cleanups.push(() => {
      client.close();
      return Promise.resolve();
    });

    await client.send({ v: PROTOCOL_VERSION, op: "start", sessionId: "esc" });
    await waitForLifecycle(logPath, ["start"], 2000);

    // Esc: no further events. Advance past the abandoned-turn timeout.
    now = 10_000;
    await daemon.runWatchdogOnce();
    await waitForLifecycle(logPath, ["start", "fade-start"], 2000);
    // Record is kept (still alive, could resume) but playback is released.
    expect(daemon.getSessionRegistry().get("esc")).toBeDefined();
    expect(daemon.getSessionRegistry().playbackCount()).toBe(0);

    // A tool heartbeat (or a new prompt) resurrects the turn → purr resumes.
    await client.send({ v: PROTOCOL_VERSION, op: "heartbeat", sessionId: "esc" });
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && daemon.getSessionRegistry().playbackCount() !== 1) {
      await sleep(10);
    }
    expect(daemon.getSessionRegistry().get("esc")!.idle).toBeUndefined();
    expect(daemon.getSessionRegistry().playbackCount()).toBe(1);
    // Resume evidence: the fade was cancelled or a fresh play started after it.
    const events = await readFakeAudioLog(logPath);
    expect(events.some((e) => e.type === "fade-cancel" || e.type === "start")).toBe(true);
  });

  it("boot re-validates snapshot sessions before playback resumes", async () => {
    const runtimeDir = await mkdtemp(join(tmpdir(), "purrcode-ttl-boot-"));
    cleanups.push(async () => rm(runtimeDir, { recursive: true, force: true }));
    const logPath = join(runtimeDir, "fake.jsonl");

    // Snapshot with one dead-PID session and one live (current process).
    writeRegistrySnapshot(runtimeDir, [
      {
        sessionId: "dead-owner",
        startedAt: 1,
        lastSeenAt: Date.now(),
        claudePid: 1_999_999_999,
        starttime: "nope",
      },
      {
        sessionId: "live-owner",
        startedAt: 1,
        lastSeenAt: Date.now(),
        claudePid: process.pid,
        starttime: "will-mismatch-or-live",
      },
    ]);

    const audio = new FakeAudioBackend({ logPath, enabled: true });
    const playback = new PlaybackController({ backend: audio, fadeOutMs: 50, fadeInMs: 0 });
    const iso = daemonIsolationOptions(runtimeDir);

    // Force classification: dead-owner gone, live-owner running with matching token.
    const daemon = new Daemon({
      ...iso,
      idleMs: 60_000,
      audioBackend: audio,
      playback,
      watchdogIntervalMs: 0,
      staleSessionMs: 60_000,
      watchdogClassify: (id) => (id.pid === process.pid ? "running" : "dead"),
      watchdogClassifyOptions: {
        // Bypass starttime mismatch by injecting snapshots that match tokens.
        readSnapshot: (pid) =>
          pid === process.pid ? { state: "S", starttime: "will-mismatch-or-live" } : null,
      },
    });
    await daemon.start();
    cleanups.push(async () => daemon.shutdown());

    expect(daemon.getSessionRegistry().get("dead-owner")).toBeUndefined();
    expect(daemon.getSessionRegistry().get("live-owner")).toBeDefined();
    expect(daemon.getSessionRegistry().playbackCount()).toBe(1);
    await waitForLifecycle(logPath, ["start"], 2000);
  });
});
