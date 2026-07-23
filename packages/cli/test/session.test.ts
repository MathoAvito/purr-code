import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FakeAudioBackend,
  assertExactSequence,
  readFakeAudioLog,
} from "../src/audio/fake/index.js";
import { SessionRegistry } from "../src/session/SessionRegistry.js";
import { PlaybackController } from "../src/session/PlaybackController.js";
import { Daemon } from "../src/daemon/Daemon.js";
import { ControlPipeClient } from "../src/control/client.js";
import { PROTOCOL_VERSION } from "../src/control/protocol.js";
import { daemonIsolationOptions } from "./helpers/controlEndpoint.js";

describe("SessionRegistry", () => {
  it("treats duplicate start as idempotent and unknown stop as no-op", () => {
    const reg = new SessionRegistry({ now: () => 1000 });
    expect(reg.start({ sessionId: "a", claudePid: 1 })).toEqual({
      created: true,
      activeCount: 1,
    });
    expect(reg.start({ sessionId: "a", claudePid: 1 })).toEqual({
      created: false,
      activeCount: 1,
    });
    expect(reg.stop("missing")).toEqual({ removed: false, activeCount: 1 });
    expect(reg.stop("a")).toEqual({ removed: true, activeCount: 0 });
    expect(reg.stop("a")).toEqual({ removed: false, activeCount: 0 });
  });

  it("updates lastSeenAt on duplicate start", () => {
    let t = 1;
    const reg = new SessionRegistry({ now: () => t++ });
    reg.start({ sessionId: "a" });
    const first = reg.get("a")!;
    expect(first.startedAt).toBe(1);
    expect(first.lastSeenAt).toBe(1);
    reg.start({ sessionId: "a" });
    expect(reg.get("a")!.lastSeenAt).toBe(2);
    expect(reg.get("a")!.startedAt).toBe(1);
  });
});

describe("PlaybackController state machine", () => {
  let dir: string;
  let logPath: string;
  let clock: number;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "purrcode-playback-"));
    logPath = join(dir, "events.jsonl");
    clock = 1;
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(dir, { recursive: true, force: true });
  });

  function backend(): FakeAudioBackend {
    return new FakeAudioBackend({
      logPath,
      enabled: true,
      now: () => clock++,
    });
  }

  it("0→1 starts; last stop fades; start during fade-out cancels", async () => {
    vi.useRealTimers();
    const audio = new FakeAudioBackend({ logPath, enabled: true });
    const pb = new PlaybackController({
      backend: audio,
      fadeOutMs: 200,
      fadeInMs: 0,
    });

    await pb.onActiveCount(1);
    expect(pb.getPhase()).toBe("playing");

    const stopPromise = pb.onActiveCount(0);
    expect(pb.getPhase()).toBe("fading-out");

    await pb.onActiveCount(1);
    expect(pb.getPhase()).toBe("playing");
    await stopPromise;

    await pb.onActiveCount(0);

    // Poll instead of a fixed sleep: the 200ms fade + log flush can exceed a
    // fixed wait on loaded CI runners (flaked on windows-latest).
    const expected = ["start", "fade-start", "fade-cancel", "start", "fade-start", "stop"] as const;
    const readFiltered = async () =>
      (await readFakeAudioLog(logPath)).filter((e) =>
        ["start", "fade-start", "fade-cancel", "stop"].includes(e.type),
      );
    const deadline = Date.now() + 4000;
    let events = await readFiltered();
    while (events.length < expected.length && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
      events = await readFiltered();
    }
    assertExactSequence(events, expected);
  });

  it("two sessions: stop one keeps playing; final stop fades", async () => {
    const audio = backend();
    const pb = new PlaybackController({ backend: audio, fadeOutMs: 0 });
    await pb.onActiveCount(1);
    await pb.onActiveCount(2);
    expect(pb.getPhase()).toBe("playing");
    await pb.onActiveCount(1);
    expect(pb.getPhase()).toBe("playing");
    await pb.onActiveCount(0);
    // fadeOutMs: 0 finishes on the microtask; second call awaits stopChain
    await pb.onActiveCount(0);
    expect(pb.getPhase()).toBe("idle");
  });

  it("play() failure recovers to idle and allows retry", async () => {
    vi.useRealTimers();
    let failOnce = true;
    const audio = {
      detect: () =>
        Promise.resolve({
          available: true,
          tier: "fake" as const,
          name: "stub",
          loop: true,
          fade: true,
          runtimeVolume: true,
        }),
      play: () => {
        if (failOnce) {
          failOnce = false;
          return Promise.reject(new Error("device busy"));
        }
        return Promise.resolve({ id: "ok" });
      },
      setVolume: () => Promise.resolve(),
      stop: () => Promise.resolve(),
    };
    const pb = new PlaybackController({ backend: audio, fadeOutMs: 0 });
    await pb.onActiveCount(1);
    expect(pb.getPhase()).toBe("idle");
    await pb.onActiveCount(1);
    expect(pb.getPhase()).toBe("playing");
  });

  it("stop during fading-in does not orphan playback", async () => {
    vi.useRealTimers();
    let releasePlay: (() => void) | undefined;
    const playGate = new Promise<void>((r) => {
      releasePlay = r;
    });
    const audio = {
      detect: () =>
        Promise.resolve({
          available: true,
          tier: "fake" as const,
          name: "stub",
          loop: true,
          fade: true,
          runtimeVolume: true,
        }),
      play: async () => {
        await playGate;
        return { id: "h1" };
      },
      setVolume: () => Promise.resolve(),
      stop: () => Promise.resolve(),
    };
    const pb = new PlaybackController({ backend: audio, fadeOutMs: 0 });
    const start = pb.onActiveCount(1);
    await Promise.resolve();
    expect(pb.getPhase()).toBe("fading-in");
    const stop = pb.onActiveCount(0);
    releasePlay?.();
    await start;
    await stop;
    expect(pb.getPhase()).toBe("idle");
  });
});

describe("Daemon + registry + fake audio", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()?.();
  });

  it("refcount through control pipe with fade-cancel", async () => {
    const dir = await mkdtemp(join(tmpdir(), "purrcode-daemon-pb-"));
    cleanups.push(async () => rm(dir, { recursive: true, force: true }));
    const logPath = join(dir, "events.jsonl");
    let clock = 1;
    const audio = new FakeAudioBackend({
      logPath,
      enabled: true,
      now: () => clock++,
    });
    const iso = daemonIsolationOptions(dir);
    const daemon = new Daemon({
      ...iso,
      idleMs: 60_000,
      audioBackend: audio,
    });
    await daemon.start();
    cleanups.push(async () => daemon.shutdown());

    const client = new ControlPipeClient({ path: daemon.controlPath });
    cleanups.push(() => {
      client.close();
      return Promise.resolve();
    });

    await client.send({ v: PROTOCOL_VERSION, op: "start", sessionId: "a" });
    await client.send({ v: PROTOCOL_VERSION, op: "start", sessionId: "b" });
    await client.send({ v: PROTOCOL_VERSION, op: "stop", sessionId: "a" });
    // Allow serialized handler queue to drain.
    await new Promise((r) => setTimeout(r, 30));
    let status = await client.request({ v: PROTOCOL_VERSION, op: "status", id: "1" });
    expect(status.result).toMatchObject({ sessions: 1, phase: "playing" });

    await client.send({ v: PROTOCOL_VERSION, op: "stop", sessionId: "b" });
    // allow fade-out (50ms default in Daemon wiring)
    await new Promise((r) => setTimeout(r, 80));
    status = await client.request({ v: PROTOCOL_VERSION, op: "status", id: "2" });
    expect(status.result).toMatchObject({ sessions: 0, phase: "idle" });
  });
});
