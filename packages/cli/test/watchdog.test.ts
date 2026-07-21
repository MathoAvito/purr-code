/**
 * Watchdog loop (PC-202): owner-kill / suspend / resume against fake audio.
 * Real child processes stand in for Claude; no stop/failure events are sent
 * on kill (ADR 0001 / PC-009 — primary abandoned-turn path).
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
import { applyWatchdogTick } from "../src/daemon/watchdog.js";
import { readStarttimeToken } from "../src/process/liveness.js";
import { PlaybackController } from "../src/session/PlaybackController.js";
import { SessionRegistry } from "../src/session/SessionRegistry.js";
import { daemonIsolationOptions } from "./helpers/controlEndpoint.js";

process.env.PURRCODE_FAKE_AUDIO = "1";

const isWin = process.platform === "win32";
const isUnix = !isWin;

function spawnSleep(): ChildProcess {
  return spawn(isWin ? "timeout" : "sleep", isWin ? ["/T", "60"] : ["60"], {
    stdio: "ignore",
    windowsHide: true,
  });
}

async function waitExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await once(child, "exit");
}

describe("applyWatchdogTick (PC-202)", () => {
  it("removes dead sessions and pauses/resumes suspended ones", () => {
    const reg = new SessionRegistry({ now: () => 1 });
    reg.start({ sessionId: "alive", claudePid: 1, starttime: "a" });
    reg.start({ sessionId: "dead", claudePid: 2, starttime: "b" });
    reg.start({ sessionId: "stopped", claudePid: 3, starttime: "c" });

    const states = new Map<number, "running" | "suspended" | "dead">([
      [1, "running"],
      [2, "dead"],
      [3, "suspended"],
    ]);

    const result = applyWatchdogTick(reg, {
      platform: "linux",
      classify: (id) => states.get(id.pid) ?? "dead",
    });

    expect(result.removed).toEqual(["dead"]);
    expect(result.paused).toEqual(["stopped"]);
    expect(reg.get("dead")).toBeUndefined();
    expect(reg.get("stopped")?.paused).toBe(true);
    expect(reg.playbackCount()).toBe(1);

    states.set(3, "running");
    const resume = applyWatchdogTick(reg, {
      platform: "linux",
      classify: (id) => states.get(id.pid) ?? "dead",
    });
    expect(resume.resumed).toEqual(["stopped"]);
    expect(reg.get("stopped")?.paused).toBeFalsy();
    expect(reg.playbackCount()).toBe(2);
  });

  it("degraded path without starttime still applies injected classifier", () => {
    const reg = new SessionRegistry();
    reg.start({ sessionId: "no-token", claudePid: 99 });
    const result = applyWatchdogTick(reg, {
      platform: "linux",
      classify: () => "dead",
    });
    expect(result.removed).toEqual(["no-token"]);
    expect(reg.size).toBe(0);
  });
});

describe("Daemon watchdog integration (PC-202)", () => {
  const cleanups: Array<() => Promise<void>> = [];
  const children: ChildProcess[] = [];

  afterEach(async () => {
    for (const child of children.splice(0)) {
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        try {
          if (isUnix) {
            try {
              process.kill(child.pid, "SIGCONT");
            } catch {
              /* ignore */
            }
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
    timeoutMs = 5000,
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

  async function harness(watchdogIntervalMs = 100): Promise<{
    logPath: string;
    daemon: Daemon;
    client: ControlPipeClient;
  }> {
    const runtimeDir = await mkdtemp(join(tmpdir(), "purrcode-wd-"));
    cleanups.push(async () => rm(runtimeDir, { recursive: true, force: true }));
    const logPath = join(runtimeDir, "fake.jsonl");
    const audio = new FakeAudioBackend({ logPath, enabled: true });
    const playback = new PlaybackController({
      backend: audio,
      fadeOutMs: 50,
      fadeInMs: 0,
    });
    const iso = daemonIsolationOptions(runtimeDir);
    const daemon = new Daemon({
      ...iso,
      idleMs: 60_000,
      audioBackend: audio,
      playback,
      watchdogIntervalMs,
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

  async function startOwnedSession(
    client: ControlPipeClient,
    sessionId: string,
    child: ChildProcess,
  ): Promise<{ pid: number; starttime: string }> {
    expect(child.pid).toBeTypeOf("number");
    const pid = child.pid!;
    const starttime = readStarttimeToken(pid) ?? "";
    if (!isWin) expect(starttime.length).toBeGreaterThan(0);
    await client.send({
      v: PROTOCOL_VERSION,
      op: "start",
      sessionId,
      claudePid: pid,
      ...(starttime ? { starttime } : {}),
    });
    return { pid, starttime };
  }

  it("owner-kill with zero stop events fades within 5 s (primary cleanup path)", async () => {
    const { client, logPath, daemon } = await harness(100);
    const child = spawnSleep();
    children.push(child);
    await startOwnedSession(client, "orphan", child);
    await waitForLifecycle(logPath, ["start"], 2000);

    const killedAt = Date.now();
    child.kill("SIGKILL");
    await waitExit(child);
    // No stop / failure / session-end — watchdog is the only cleanup path.
    await waitForLifecycle(logPath, ["start", "fade-start"], 5000);
    expect(Date.now() - killedAt).toBeLessThanOrEqual(5000);
    expect(daemon.getSessionRegistry().get("orphan")).toBeUndefined();
  });

  it.runIf(isUnix)("SIGSTOP pauses (fade) within one cycle; SIGCONT resumes playback", async () => {
    const { client, logPath, daemon } = await harness(100);
    const child = spawnSleep();
    children.push(child);
    const { pid } = await startOwnedSession(client, "s1", child);
    await waitForLifecycle(logPath, ["start"], 2000);

    process.kill(pid, "SIGSTOP");
    await waitForLifecycle(logPath, ["start", "fade-start"], 2000);
    expect(daemon.getSessionRegistry().get("s1")?.paused).toBe(true);
    // Session kept — turn still open.
    expect(daemon.sessionCount).toBe(1);

    const eventsBeforeResume = await readFakeAudioLog(logPath);
    const startsBefore = eventsBeforeResume.filter((e) => e.type === "start").length;
    const cancelsBefore = eventsBeforeResume.filter((e) => e.type === "fade-cancel").length;

    process.kill(pid, "SIGCONT");
    const deadline = Date.now() + 3000;
    let resumed = false;
    while (Date.now() < deadline) {
      const paused = daemon.getSessionRegistry().get("s1")?.paused === true;
      const events = await readFakeAudioLog(logPath);
      const starts = events.filter((e) => e.type === "start").length;
      const cancels = events.filter((e) => e.type === "fade-cancel").length;
      if (!paused && (starts > startsBefore || cancels > cancelsBefore)) {
        resumed = true;
        break;
      }
      await sleep(25);
    }
    expect(resumed).toBe(true);
    expect(daemon.getSessionRegistry().get("s1")?.paused).toBeFalsy();
    expect(daemon.getSessionRegistry().playbackCount()).toBe(1);
  });

  it.runIf(isUnix)("one suspended + one running keeps purring", async () => {
    const { client, logPath, daemon } = await harness(100);
    const a = spawnSleep();
    const b = spawnSleep();
    children.push(a, b);
    const ownedA = await startOwnedSession(client, "a", a);
    await startOwnedSession(client, "b", b);
    await waitForLifecycle(logPath, ["start"], 2000);

    process.kill(ownedA.pid, "SIGSTOP");
    // Wait one+ watchdog cycles for pause of A.
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      if (daemon.getSessionRegistry().get("a")?.paused) break;
      await sleep(25);
    }
    expect(daemon.getSessionRegistry().get("a")?.paused).toBe(true);
    expect(daemon.getSessionRegistry().get("b")?.paused).toBeFalsy();
    expect(daemon.getSessionRegistry().playbackCount()).toBe(1);

    // Give another cycle — must NOT fade out while B is running.
    await sleep(250);
    const events = await readFakeAudioLog(logPath);
    const fadeStarts = events.filter((e) => e.type === "fade-start");
    expect(fadeStarts.length).toBe(0);
    expect(daemon.getSessionRegistry().playbackCount()).toBe(1);
  });

  it("watchdog tick does not require stop/failure to clean a dead owner", async () => {
    // Explicit PC-009 coverage: injected classifier, zero pipe stop events.
    const runtimeDir = await mkdtemp(join(tmpdir(), "purrcode-wd-inject-"));
    cleanups.push(async () => rm(runtimeDir, { recursive: true, force: true }));
    const logPath = join(runtimeDir, "fake.jsonl");
    const audio = new FakeAudioBackend({ logPath, enabled: true });
    const playback = new PlaybackController({ backend: audio, fadeOutMs: 50, fadeInMs: 0 });
    const iso = daemonIsolationOptions(runtimeDir);

    let live = true;
    const daemon = new Daemon({
      ...iso,
      idleMs: 60_000,
      audioBackend: audio,
      playback,
      watchdogIntervalMs: 0, // manual ticks only
      watchdogClassify: () => (live ? "running" : "dead"),
      platform: "linux",
    });
    await daemon.start();
    cleanups.push(async () => daemon.shutdown());
    const client = new ControlPipeClient({ path: daemon.controlPath });
    cleanups.push(() => {
      client.close();
      return Promise.resolve();
    });

    await client.send({
      v: PROTOCOL_VERSION,
      op: "start",
      sessionId: "injected",
      claudePid: 42,
      starttime: "tok",
    });
    await waitForLifecycle(logPath, ["start"], 2000);

    live = false;
    await daemon.runWatchdogOnce();
    await waitForLifecycle(logPath, ["start", "fade-start"], 2000);
    expect(daemon.getSessionRegistry().size).toBe(0);
  });
});
