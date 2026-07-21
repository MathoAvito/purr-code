export type {
  AudioBackend,
  BackendCapabilities,
  BackendTier,
  PlaybackOptions,
  PlayerHandle,
} from "./types.js";

export {
  applyVolumeForTier,
  clampPerceptualVolume,
  interpolatePerceptualVolume,
  perceptualToGainDb,
  perceptualToLinearAmplitude,
  samplePerceptualRamp,
  type VolumeApplication,
} from "./perceptual.js";

export * from "./fake/index.js";
