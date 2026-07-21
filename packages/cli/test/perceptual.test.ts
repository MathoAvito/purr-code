import { describe, expect, it } from "vitest";

import {
  applyVolumeForTier,
  clampPerceptualVolume,
  interpolatePerceptualVolume,
  perceptualToGainDb,
  perceptualToLinearAmplitude,
  samplePerceptualRamp,
} from "../src/audio/perceptual.js";
import { FakeAudioBackend } from "../src/audio/fake/FakeAudioBackend.js";
import { readFakeAudioLog } from "../src/audio/fake/log.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("perceptual volume model (PC-205)", () => {
  it("gain_dB = −60 + 0.6·v and v=0 is hard mute", () => {
    expect(perceptualToGainDb(0)).toBe(Number.NEGATIVE_INFINITY);
    expect(perceptualToLinearAmplitude(0)).toBe(0);
    expect(perceptualToGainDb(100)).toBeCloseTo(0, 10);
    expect(perceptualToLinearAmplitude(100)).toBeCloseTo(1, 10);
    expect(perceptualToGainDb(20)).toBeCloseTo(-48, 10);
    expect(perceptualToGainDb(50)).toBeCloseTo(-30, 10);
  });

  it("linear amplitude is monotonic over 0–100", () => {
    let prev = -1;
    for (let v = 0; v <= 100; v++) {
      const a = perceptualToLinearAmplitude(v);
      expect(a).toBeGreaterThanOrEqual(prev);
      prev = a;
    }
    expect(perceptualToLinearAmplitude(20)).toBeLessThan(perceptualToLinearAmplitude(60));
    expect(perceptualToLinearAmplitude(60)).toBeLessThan(perceptualToLinearAmplitude(100));
  });

  it("fade ramps interpolate in the perceptual domain", () => {
    expect(interpolatePerceptualVolume(0, 100, 0)).toBe(0);
    expect(interpolatePerceptualVolume(0, 100, 1)).toBe(100);
    expect(interpolatePerceptualVolume(0, 100, 0.5)).toBe(50);
    expect(interpolatePerceptualVolume(80, 20, 0.25)).toBe(65);

    const ramp = samplePerceptualRamp(100, 0, 5);
    expect(ramp).toEqual([100, 75, 50, 25, 0]);
    // Equal steps in perceptual space — NOT equal linear-amplitude steps.
    const linear = ramp.map(perceptualToLinearAmplitude);
    const d01 = linear[1]! - linear[0]!;
    const d12 = linear[2]! - linear[1]!;
    expect(Math.abs(d01 - d12)).toBeGreaterThan(1e-6);
  });

  it("clamp rejects non-finite / out-of-range", () => {
    expect(clampPerceptualVolume(-5)).toBe(0);
    expect(clampPerceptualVolume(120)).toBe(100);
    expect(clampPerceptualVolume(Number.NaN)).toBe(0);
  });

  it("adapter contract: single application per tier (no double-map on mpv/fake)", () => {
    const fake = applyVolumeForTier("fake", 40);
    expect(fake).toEqual({ mode: "perceptual-pass-through", perceptual: 40 });

    const mpv = applyVolumeForTier("mpv", 40);
    expect(mpv).toEqual({ mode: "perceptual-pass-through", perceptual: 40 });

    const sidecar = applyVolumeForTier("sidecar", 40);
    expect(sidecar.mode).toBe("linear-amplitude");
    if (sidecar.mode === "linear-amplitude") {
      expect(sidecar.perceptual).toBe(40);
      expect(sidecar.linearAmplitude).toBeCloseTo(perceptualToLinearAmplitude(40), 10);
      // Exactly one conversion — re-applying would disagree.
      expect(sidecar.linearAmplitude).not.toBe(40);
      expect(sidecar.linearAmplitude).not.toBeCloseTo(
        perceptualToLinearAmplitude(perceptualToLinearAmplitude(40) * 100),
        2,
      );
    }

    const native = applyVolumeForTier("native", 0);
    expect(native).toEqual({
      mode: "linear-amplitude",
      perceptual: 0,
      linearAmplitude: 0,
    });
  });

  it("fake backend records the perceptual value (no amplitude conversion)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "purrcode-perc-"));
    try {
      const logPath = join(dir, "e.jsonl");
      const backend = new FakeAudioBackend({ logPath, enabled: true });
      const handle = await backend.play({ soundPath: "fake://sleepy", volume: 20 });
      await backend.setVolume(handle, 60);
      const events = await readFakeAudioLog(logPath);
      const start = events.find((e) => e.type === "start");
      const vol = events.find((e) => e.type === "volume-change");
      expect(start?.volume).toBe(20);
      expect(vol?.volume).toBe(60);
      // Must not look like linear amplitude (~0.004 for v=20).
      expect(start?.volume).toBeGreaterThan(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
