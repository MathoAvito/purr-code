import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FakeAudioBackend,
  assertContainsSequence,
  assertExactSequence,
  isFakeAudioEnabled,
  readFakeAudioLog,
  resolveFakeAudioLogPath,
} from "../src/index.js";

describe("isFakeAudioEnabled", () => {
  it("accepts 1 / true / yes", () => {
    expect(isFakeAudioEnabled({ PURRCODE_FAKE_AUDIO: "1" })).toBe(true);
    expect(isFakeAudioEnabled({ PURRCODE_FAKE_AUDIO: "true" })).toBe(true);
    expect(isFakeAudioEnabled({ PURRCODE_FAKE_AUDIO: "yes" })).toBe(true);
  });

  it("rejects unset / other values", () => {
    expect(isFakeAudioEnabled({})).toBe(false);
    expect(isFakeAudioEnabled({ PURRCODE_FAKE_AUDIO: "0" })).toBe(false);
    expect(isFakeAudioEnabled({ PURRCODE_FAKE_AUDIO: "false" })).toBe(false);
  });
});

describe("resolveFakeAudioLogPath", () => {
  it("prefers PURRCODE_FAKE_AUDIO_LOG", () => {
    expect(resolveFakeAudioLogPath({ PURRCODE_FAKE_AUDIO_LOG: "/tmp/custom.jsonl" })).toBe(
      "/tmp/custom.jsonl",
    );
  });
});

describe("FakeAudioBackend", () => {
  let dir: string;
  let logPath: string;
  let clock: number;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "purrcode-fake-audio-"));
    logPath = join(dir, "events.jsonl");
    clock = 1_000;
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(dir, { recursive: true, force: true });
  });

  function createBackend(enabled = true): FakeAudioBackend {
    return new FakeAudioBackend({
      logPath,
      enabled,
      now: () => clock++,
    });
  }

  it("detect is unavailable when fake audio is off", async () => {
    const backend = createBackend(false);
    const caps = await backend.detect();
    expect(caps).toEqual({
      available: false,
      tier: "none",
      name: "fake",
      loop: false,
      fade: false,
      runtimeVolume: false,
    });
    expect(await readFakeAudioLog(logPath)).toEqual([]);
  });

  it("detect wins when enabled and emits a ready (sidecar) event once", async () => {
    const backend = createBackend(true);
    const caps = await backend.detect();
    expect(caps.available).toBe(true);
    expect(caps.tier).toBe("fake");
    expect(caps.loop && caps.fade && caps.runtimeVolume).toBe(true);

    await backend.detect();
    const events = await readFakeAudioLog(logPath);
    assertExactSequence(events, ["ready"]);
    expect(events[0]?.sidecar).toBe("ready");
  });

  it("records start → volume-change → fade-start → stop with perceptual volumes", async () => {
    const backend = createBackend();
    await backend.detect();

    const handle = await backend.play({
      soundPath: "/sounds/sleepy.wav",
      volume: 40,
      fadeInMs: 400,
    });
    await backend.setVolume(handle, 70);

    const stopPromise = backend.stop(handle, 250);
    // Allow stop() to finish the fade-start write and register its timer.
    await vi.waitFor(() => {
      expect(vi.getTimerCount()).toBeGreaterThan(0);
    });
    await vi.advanceTimersByTimeAsync(250);
    await stopPromise;

    const events = await readFakeAudioLog(logPath);
    assertContainsSequence(events, ["ready", "start", "volume-change", "fade-start", "stop"]);

    const start = events.find((e) => e.type === "start");
    expect(start).toMatchObject({
      sidecar: "playing",
      volume: 40,
      fadeInMs: 400,
      soundPath: "/sounds/sleepy.wav",
    });

    const vol = events.find((e) => e.type === "volume-change");
    expect(vol).toMatchObject({ sidecar: "volume", volume: 70 });

    const fade = events.find((e) => e.type === "fade-start");
    expect(fade).toMatchObject({ sidecar: "fadeout", fadeOutMs: 250, volume: 70 });

    const stop = events.find((e) => e.type === "stop");
    expect(stop).toMatchObject({ sidecar: "exiting", volume: 70 });
  });

  it("emits fade-cancel when play arrives during fade-out", async () => {
    const backend = createBackend();
    const handle = await backend.play({ soundPath: "a.wav", volume: 50 });

    const stopPromise = backend.stop(handle, 500);
    await vi.waitFor(() => {
      expect(vi.getTimerCount()).toBeGreaterThan(0);
    });
    await vi.advanceTimersByTimeAsync(100);

    const next = await backend.play({ soundPath: "b.wav", volume: 60, fadeInMs: 0 });
    await stopPromise;

    await backend.stop(next, 0);

    const events = await readFakeAudioLog(logPath);
    assertContainsSequence(events, [
      "start",
      "fade-start",
      "fade-cancel",
      "start",
      "fade-start",
      "stop",
    ]);
    expect(events.filter((e) => e.type === "stop")).toHaveLength(1);
  });

  it("stop with fadeOutMs 0 completes synchronously", async () => {
    const backend = createBackend();
    const handle = await backend.play({ soundPath: "a.wav", volume: 20 });
    await backend.stop(handle, 0);

    const events = await readFakeAudioLog(logPath);
    assertExactSequence(events, ["start", "fade-start", "stop"]);
  });

  it("rejects setVolume / stop for unknown handles", async () => {
    const backend = createBackend();
    await backend.play({ soundPath: "a.wav", volume: 10 });
    await expect(backend.setVolume({ id: "nope" }, 5)).rejects.toThrow(/unknown or stale/);
  });
});

describe("assertContainsSequence helper", () => {
  it("throws a useful message when the sequence is missing", () => {
    expect(() =>
      assertContainsSequence([{ ts: 1, type: "start" }], ["fade-start", "stop"]),
    ).toThrow(/fade-start → stop/);
  });
});
