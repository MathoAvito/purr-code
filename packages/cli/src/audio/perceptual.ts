import type { BackendTier } from "./types.js";

/**
 * Shared perceptual volume model (PC-205 / FR-06).
 *
 * User-facing `v` is 0–100. Mapping:
 *   gain_dB = −60 + 0.6·v
 *   v = 0 → hard mute (linear amplitude 0)
 *
 * Applied **inside each backend adapter**, never in the daemon.
 * - fake: records the perceptual value (no amplitude conversion)
 * - mpv: pass perceptual through (mpv has its own curve — no double-map)
 * - sidecar / native: convert once via {@link perceptualToLinearAmplitude}
 */

/** Clamp to the user-facing 0–100 scale. */
export function clampPerceptualVolume(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v <= 0) return 0;
  if (v >= 100) return 100;
  return v;
}

/**
 * Perceptual volume → gain in dB.
 * `v = 0` is defined as −∞ for mute (callers should hard-mute instead).
 */
export function perceptualToGainDb(v: number): number {
  const p = clampPerceptualVolume(v);
  if (p === 0) return Number.NEGATIVE_INFINITY;
  return -60 + 0.6 * p;
}

/**
 * Perceptual volume → linear amplitude in [0, 1].
 * `v = 0` → hard mute (0). At v=100, gain_dB = 0 → amplitude 1.
 */
export function perceptualToLinearAmplitude(v: number): number {
  const p = clampPerceptualVolume(v);
  if (p === 0) return 0;
  const db = perceptualToGainDb(p);
  return 10 ** (db / 20);
}

/**
 * Interpolate fade ramps in the **perceptual** domain (FR-06).
 * `t` is progress in [0, 1].
 */
export function interpolatePerceptualVolume(from: number, to: number, t: number): number {
  const a = clampPerceptualVolume(from);
  const b = clampPerceptualVolume(to);
  const u = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;
  return clampPerceptualVolume(a + (b - a) * u);
}

/** Sample a perceptual fade ramp into `steps` inclusive endpoints. */
export function samplePerceptualRamp(from: number, to: number, steps: number): number[] {
  const n = Math.max(2, Math.floor(steps));
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(interpolatePerceptualVolume(from, to, i / (n - 1)));
  }
  return out;
}

export type VolumeApplication =
  | { mode: "perceptual-pass-through"; perceptual: number }
  | { mode: "linear-amplitude"; perceptual: number; linearAmplitude: number };

/**
 * Single-application contract per backend tier (PC-205).
 * Ensures mpv/fake never double-map; sidecar/native convert once.
 */
export function applyVolumeForTier(tier: BackendTier, perceptual: number): VolumeApplication {
  const p = clampPerceptualVolume(perceptual);
  if (tier === "sidecar" || tier === "native") {
    return {
      mode: "linear-amplitude",
      perceptual: p,
      linearAmplitude: perceptualToLinearAmplitude(p),
    };
  }
  // fake / mpv / none — pass perceptual through (mpv applies its own curve).
  return { mode: "perceptual-pass-through", perceptual: p };
}
