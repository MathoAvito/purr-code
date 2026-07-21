/**
 * Failure-injection & chaos pass (PC-206 / RR-02).
 * Demonstrates fail-open, fail-silent under systematic faults.
 */
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { AudioBackend } from "../src/audio/types.js";
import {
  FakeAudioBackend,
  assertContainsSequence,
  readFakeAudioLog,
} from "../src/audio/fake/index.js";
import { ControlPipeClient } from "../src/control/client.js";
import { PROTOCOL_VERSION } from "../src/control/protocol.js";
import { Daemon } from "../src/daemon/Daemon.js";
import type { EnsureDaemonResult } from "../src/daemon/spawn.js";
import { runHook } from "../src/hook/runHook.js";
import { PlaybackController } from "../src/session/PlaybackController.js";
import { daemonIsolationOptions } from "./helpers/controlEndpoint.js";

process.env.PURRCODE_FAKE_AUDIO = "1";

describe("chaos: hook fail-silent (PC-206)", () => {
  it("daemon dead / spawn failure / send failure → runHook never throws", async () => {
    await expect(
      runHook({
        event: "start",
        stdin: JSON.stringify({ session_id: "x" }),
        env: {},
        ensureDaemon: () => Promise.reject(new Error("spawn failed")),
      }),
    ).resolves.toBeUndefined();

    await expect(
      runHook({
        event: "start",
        stdin: JSON.stringify({ session_id: "x" }),
        env: {},
        send: () => Promise.reject(new Error("daemon dead")),
      }),
    ).resolves.toBeUndefined();
  });

  it("stdin garbage / oversized → silent no-op", async () => {
    await runHook({
      event: "start",
      stdin: "{not-json",
      env: {},
      send: () => {
        throw new Error("must not send");
      },
    });
    await runHook({
      event: "start",
      stdin: "x".repeat(300_000),
      env: {},
      send: () => {
        throw new Error("must not send");
      },
    });
  });

  it("socket present-but-unresponsive → send timeout fails open", async () => {
    let finished = false;
    const result = await Promise.race([
      runHook({
        event: "start",
        stdin: JSON.stringify({ session_id: "hang" }),
        env: {},
        ensureDaemon: (): Promise<EnsureDaemonResult> => {
          const client = {
            send: () =>
              new Promise<void>((_, reject) => {
                setTimeout(() => reject(new Error("socket unresponsive")), 30);
              }),
            close: () => undefined,
            pathName: "/tmp/fake.sock",
            ensureConnected: () => Promise.reject(new Error("unused")),
            request: () => Promise.reject(new Error("unused")),
          };
          return Promise.resolve({
            status: "already-running" as const,
            path: "/tmp/fake.sock",
            client: client as unknown as EnsureDaemonResult["client"],
          });
        },
      }).then(() => {
        finished = true;
      }),
      new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 2000)),
    ]);
    expect(result).not.toBe("timeout");
    expect(finished).toBe(true);
  });

  it("runtime dir unwritable / spawn EACCES → fail open", async () => {
    await expect(
      runHook({
        event: "start",
        stdin: JSON.stringify({ session_id: "ro" }),
        env: {},
        ensureDaemon: () => Promise.reject(Object.assign(new Error("EACCES"), { code: "EACCES" })),
      }),
    ).resolves.toBeUndefined();
  });
});

describe("chaos: daemon resilience (PC-206)", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()?.();
  });

  async function sleep(ms: number): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
  }

  it("backend play() throwing leaves daemon alive and idle", async () => {
    const runtimeDir = await mkdtemp(join(tmpdir(), "purrcode-chaos-play-"));
    cleanups.push(async () => rm(runtimeDir, { recursive: true, force: true }));
    const throwing: AudioBackend = {
      detect: () =>
        Promise.resolve({
          available: true,
          tier: "fake" as const,
          name: "throw",
          loop: true,
          fade: true,
          runtimeVolume: true,
        }),
      play: () => Promise.reject(new Error("play boom")),
      stop: () => Promise.resolve(),
    };
    const playback = new PlaybackController({ backend: throwing, fadeOutMs: 10 });
    const iso = daemonIsolationOptions(runtimeDir);
    const daemon = new Daemon({
      ...iso,
      idleMs: 60_000,
      audioBackend: throwing,
      playback,
      watchdogIntervalMs: 0,
    });
    await daemon.start();
    cleanups.push(async () => daemon.shutdown());
    const client = new ControlPipeClient({ path: daemon.controlPath });
    cleanups.push(() => {
      client.close();
      return Promise.resolve();
    });

    await client.send({ v: PROTOCOL_VERSION, op: "start", sessionId: "boom" });
    await sleep(40);
    expect(daemon.sessionCount).toBe(1);
    expect(playback.getPhase()).toBe("idle");
    const status = await client.request({ v: PROTOCOL_VERSION, op: "status", id: "s" });
    expect(status.ok).toBe(true);
  });

  it("player crash during active session respawns on next sync (PC-206 / §18)", async () => {
    const runtimeDir = await mkdtemp(join(tmpdir(), "purrcode-chaos-crash-"));
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
      watchdogIntervalMs: 0,
    });
    await daemon.start();
    cleanups.push(async () => daemon.shutdown());
    const client = new ControlPipeClient({ path: daemon.controlPath });
    cleanups.push(() => {
      client.close();
      return Promise.resolve();
    });

    await client.send({ v: PROTOCOL_VERSION, op: "start", sessionId: "alive" });
    await sleep(40);
    expect(playback.getPhase()).toBe("playing");

    // Simulate player process death.
    playback.invalidateHandle();
    expect(playback.getPhase()).toBe("idle");

    // Session still active — syncPlayback via status/reconcile path: send a touch start.
    await client.send({ v: PROTOCOL_VERSION, op: "start", sessionId: "alive" });
    await sleep(40);
    expect(playback.getPhase()).toBe("playing");
    const events = await readFakeAudioLog(logPath);
    expect(events.filter((e) => e.type === "start").length).toBeGreaterThanOrEqual(2);
  });

  it("snapshot write failure does not crash the daemon", async () => {
    const runtimeDir = await mkdtemp(join(tmpdir(), "purrcode-chaos-snap-"));
    cleanups.push(async () => rm(runtimeDir, { recursive: true, force: true }));
    const logPath = join(runtimeDir, "fake.jsonl");
    const audio = new FakeAudioBackend({ logPath, enabled: true });
    const playback = new PlaybackController({ backend: audio, fadeOutMs: 30, fadeInMs: 0 });
    const iso = daemonIsolationOptions(runtimeDir);

    // Occupy registry.json as a directory so atomic rename/write fails.
    await writeFile(join(runtimeDir, "registry.json"), "x");
    // Replace file with a directory after first write attempt setup — use chmod on parent after start.
    const daemon = new Daemon({
      ...iso,
      idleMs: 60_000,
      audioBackend: audio,
      playback,
      watchdogIntervalMs: 0,
    });
    await daemon.start();
    cleanups.push(async () => daemon.shutdown());
    const client = new ControlPipeClient({ path: daemon.controlPath });
    cleanups.push(() => {
      client.close();
      return Promise.resolve();
    });

    // Make runtime dir read-only so snapshot writes fail.
    await chmod(runtimeDir, 0o500);
    await client.send({ v: PROTOCOL_VERSION, op: "start", sessionId: "s" });
    await sleep(80);
    // Daemon still serves status.
    await chmod(runtimeDir, 0o700);
    const status = await client.request({ v: PROTOCOL_VERSION, op: "status", id: "ok" });
    expect(status.ok).toBe(true);
    expect(daemon.sessionCount).toBe(1);
  });

  it("SIGTERM mid-fade: shutdown completes without throw", async () => {
    const runtimeDir = await mkdtemp(join(tmpdir(), "purrcode-chaos-term-"));
    cleanups.push(async () => rm(runtimeDir, { recursive: true, force: true }));
    const logPath = join(runtimeDir, "fake.jsonl");
    const audio = new FakeAudioBackend({ logPath, enabled: true });
    const playback = new PlaybackController({ backend: audio, fadeOutMs: 500, fadeInMs: 0 });
    const iso = daemonIsolationOptions(runtimeDir);
    const daemon = new Daemon({
      ...iso,
      idleMs: 60_000,
      audioBackend: audio,
      playback,
      watchdogIntervalMs: 0,
    });
    await daemon.start();
    const client = new ControlPipeClient({ path: daemon.controlPath });
    await client.send({ v: PROTOCOL_VERSION, op: "start", sessionId: "fade" });
    await sleep(30);
    await client.send({ v: PROTOCOL_VERSION, op: "stop", sessionId: "fade" });
    await sleep(20); // mid-fade
    await expect(daemon.shutdown("sigterm")).resolves.toBeUndefined();
    client.close();
    const events = await readFakeAudioLog(logPath);
    assertContainsSequence(
      events.filter((e) => ["start", "fade-start"].includes(e.type)),
      ["start", "fade-start"],
    );
  });

  it("rapid-fire: 50 interleaved start/stop across 5 sessions — consistent final state", async () => {
    const runtimeDir = await mkdtemp(join(tmpdir(), "purrcode-chaos-stress-"));
    cleanups.push(async () => rm(runtimeDir, { recursive: true, force: true }));
    const logPath = join(runtimeDir, "fake.jsonl");
    const audio = new FakeAudioBackend({ logPath, enabled: true });
    const playback = new PlaybackController({ backend: audio, fadeOutMs: 20, fadeInMs: 0 });
    const iso = daemonIsolationOptions(runtimeDir);
    const daemon = new Daemon({
      ...iso,
      idleMs: 60_000,
      audioBackend: audio,
      playback,
      watchdogIntervalMs: 0,
    });
    await daemon.start();
    cleanups.push(async () => daemon.shutdown());
    const client = new ControlPipeClient({ path: daemon.controlPath });
    cleanups.push(() => {
      client.close();
      return Promise.resolve();
    });

    const sessions = ["a", "b", "c", "d", "e"];
    // Fire-and-forget burst (concurrent writes); pipe serializes handlers.
    const burst: Array<Promise<void>> = [];
    for (let i = 0; i < 50; i++) {
      const id = sessions[i % sessions.length]!;
      const op = i % 2 === 0 ? "start" : "stop";
      burst.push(client.send({ v: PROTOCOL_VERSION, op, sessionId: id }));
    }
    await Promise.all(burst);
    // Deterministic cleanup — every session stopped after the storm.
    for (const id of sessions) {
      await client.send({ v: PROTOCOL_VERSION, op: "stop", sessionId: id });
    }
    await client.request({ v: PROTOCOL_VERSION, op: "status", id: "final" });
    await sleep(100);

    expect(daemon.sessionCount).toBe(0);
    expect(playback.getPhase()).not.toBe("playing");
    expect(["idle", "fading-out"]).toContain(playback.getPhase());
  });
});

describe("chaos: crashing backend handle (PC-206)", () => {
  it("invalidateHandle + onActiveCount respawns player", async () => {
    const dir = await mkdtemp(join(tmpdir(), "purrcode-chaos-inv-"));
    try {
      const logPath = join(dir, "f.jsonl");
      const audio = new FakeAudioBackend({ logPath, enabled: true });
      const playback = new PlaybackController({ backend: audio, fadeOutMs: 10 });
      await playback.onActiveCount(1);
      expect(playback.getPhase()).toBe("playing");
      playback.invalidateHandle();
      await playback.onActiveCount(1);
      expect(playback.getPhase()).toBe("playing");
      const starts = (await readFakeAudioLog(logPath)).filter((e) => e.type === "start");
      expect(starts.length).toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
