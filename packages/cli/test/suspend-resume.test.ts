/**
 * Suspend/resume turn-state correctness (PC-207).
 * Drive with SIGSTOP/SIGCONT only — never SIGTSTP (ADR 0002 / PC-009).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
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
import { readStarttimeToken } from "../src/process/liveness.js";
import { PlaybackController } from "../src/session/PlaybackController.js";
import { daemonIsolationOptions } from "./helpers/controlEndpoint.js";

process.env.PURRCODE_FAKE_AUDIO = "1";

const isUnix = process.platform !== "win32";

function spawnSleep(): ChildProcess {
  return spawn("sleep", ["60"], { stdio: "ignore" });
}

async function waitExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await once(child, "exit");
}

describe.skipIf(!isUnix)("suspend/resume turn-state (PC-207)", () => {
  const cleanups: Array<() => Promise<void>> = [];
  const children: ChildProcess[] = [];

  afterEach(async () => {
    for (const child of children.splice(0)) {
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        try {
          try {
            process.kill(child.pid, "SIGCONT");
          } catch {
            /* ignore */
          }
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }
      await waitExit(child).catch(() => undefined);
    }
    while (cleanups.length) await cleanups.pop()?.();
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

  async function harness(
    options: {
      watchdogIntervalMs?: number;
      staleSessionMs?: number;
      now?: () => number;
    } = {},
  ): Promise<{
    logPath: string;
    daemon: Daemon;
    client: ControlPipeClient;
  }> {
    const runtimeDir = await mkdtemp(join(tmpdir(), "purrcode-sr-"));
    cleanups.push(async () => rm(runtimeDir, { recursive: true, force: true }));
    const logPath = join(runtimeDir, "fake.jsonl");
    const audio = new FakeAudioBackend({ logPath, enabled: true });
    const playback = new PlaybackController({ backend: audio, fadeOutMs: 50, fadeInMs: 0 });
    const iso = daemonIsolationOptions(runtimeDir);
    const daemon = new Daemon({
      ...iso,
      idleMs: 60_000,
      audioBackend: audio,
      playback,
      watchdogIntervalMs: options.watchdogIntervalMs ?? 100,
      ...(options.staleSessionMs !== undefined ? { staleSessionMs: options.staleSessionMs } : {}),
      ...(options.now !== undefined ? { now: options.now } : {}),
    });
    await daemon.start();
    cleanups.push(async () => daemon.shutdown());
    const client = new ControlPipeClient({ path: daemon.controlPath });
    cleanups.push(() => {
      client.close();
      return Promise.resolve();
    });
    return { logPath, daemon, client };
  }

  async function startOwned(
    client: ControlPipeClient,
    sessionId: string,
    child: ChildProcess,
  ): Promise<{ pid: number; starttime: string }> {
    const pid = child.pid!;
    const starttime = readStarttimeToken(pid)!;
    await client.send({
      v: PROTOCOL_VERSION,
      op: "start",
      sessionId,
      claudePid: pid,
      starttime,
    });
    return { pid, starttime };
  }

  it("suspend → resume with turn still open → playback resumes (SIGSTOP/SIGCONT)", async () => {
    const { client, logPath, daemon } = await harness();
    const child = spawnSleep();
    children.push(child);
    const { pid } = await startOwned(client, "open", child);
    await waitForLifecycle(logPath, ["start"], 2000);

    process.kill(pid, "SIGSTOP");
    await waitForLifecycle(logPath, ["start", "fade-start"], 2000);
    expect(daemon.getSessionRegistry().get("open")?.paused).toBe(true);
    // Registry entry kept — turn still open.
    expect(daemon.sessionCount).toBe(1);

    const startsBefore = (await readFakeAudioLog(logPath)).filter((e) => e.type === "start").length;
    const cancelsBefore = (await readFakeAudioLog(logPath)).filter(
      (e) => e.type === "fade-cancel",
    ).length;

    process.kill(pid, "SIGCONT");
    const deadline = Date.now() + 3000;
    let ok = false;
    while (Date.now() < deadline) {
      const sess = daemon.getSessionRegistry().get("open");
      const events = await readFakeAudioLog(logPath);
      const starts = events.filter((e) => e.type === "start").length;
      const cancels = events.filter((e) => e.type === "fade-cancel").length;
      if (sess && !sess.paused && (starts > startsBefore || cancels > cancelsBefore)) {
        ok = true;
        break;
      }
      await sleep(25);
    }
    expect(ok).toBe(true);
    expect(daemon.getSessionRegistry().playbackCount()).toBe(1);
  });

  it("suspend → stop arrives → resume → no playback", async () => {
    const { client, logPath, daemon } = await harness();
    const child = spawnSleep();
    children.push(child);
    const { pid } = await startOwned(client, "closed", child);
    await waitForLifecycle(logPath, ["start"], 2000);

    process.kill(pid, "SIGSTOP");
    const pauseDeadline = Date.now() + 2000;
    while (Date.now() < pauseDeadline) {
      if (daemon.getSessionRegistry().get("closed")?.paused) break;
      await sleep(25);
    }
    expect(daemon.getSessionRegistry().get("closed")?.paused).toBe(true);

    // Stop while suspended — turn is no longer open.
    await client.send({ v: PROTOCOL_VERSION, op: "stop", sessionId: "closed" });
    const stopDeadline = Date.now() + 2000;
    while (Date.now() < stopDeadline) {
      if (daemon.getSessionRegistry().get("closed") === undefined) break;
      await sleep(10);
    }
    expect(daemon.getSessionRegistry().get("closed")).toBeUndefined();
    await waitForLifecycle(logPath, ["start", "fade-start"], 2000);

    const startsAfterStop = (await readFakeAudioLog(logPath)).filter(
      (e) => e.type === "start",
    ).length;

    // Owner returns to running — must NOT restart purr (no session / turn closed).
    process.kill(pid, "SIGCONT");
    await sleep(400);
    await daemon.runWatchdogOnce();
    await sleep(100);

    expect(daemon.sessionCount).toBe(0);
    expect(daemon.getSessionRegistry().playbackCount()).toBe(0);
    const startsFinal = (await readFakeAudioLog(logPath)).filter((e) => e.type === "start").length;
    expect(startsFinal).toBe(startsAfterStop);
  });

  it("TTL continues during suspension — stale paused session is GC'd", async () => {
    // Decision (PC-207): TTL keeps counting while paused (no spike evidence to freeze it).
    let now = 1_000;
    const { client, logPath, daemon } = await harness({
      watchdogIntervalMs: 0,
      staleSessionMs: 500,
      now: () => now,
    });
    const child = spawnSleep();
    children.push(child);
    const { pid } = await startOwned(client, "stale-paused", child);
    await waitForLifecycle(logPath, ["start"], 2000);

    // Force pause via classifier path: SIGSTOP + ticks until T is observed.
    process.kill(pid, "SIGSTOP");
    const pauseDeadline = Date.now() + 2000;
    while (Date.now() < pauseDeadline) {
      await daemon.runWatchdogOnce();
      if (daemon.getSessionRegistry().get("stale-paused")?.paused) break;
      await sleep(20);
    }
    expect(daemon.getSessionRegistry().get("stale-paused")?.paused).toBe(true);
    expect(daemon.sessionCount).toBe(1);

    // Advance past TTL without any events for this session.
    now = 2_000;
    await daemon.runWatchdogOnce();
    expect(daemon.getSessionRegistry().get("stale-paused")).toBeUndefined();
    await waitForLifecycle(logPath, ["start", "fade-start"], 2000);

    // CONT after GC must not revive playback.
    process.kill(pid, "SIGCONT");
    await daemon.runWatchdogOnce();
    expect(daemon.sessionCount).toBe(0);
  });
});
