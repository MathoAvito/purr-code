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

export { NoneAudioBackend } from "./none/NoneAudioBackend.js";
export { MpvAudioBackend, type MpvAudioBackendOptions } from "./mpv/index.js";
export {
  NativeAudioBackend,
  defaultResolvePlayer,
  type NativeAudioBackendOptions,
  type NativePlayer,
} from "./native/index.js";
export {
  ensureWavCache,
  isWavBuffer,
  isWavFile,
  sanitizeSoundName,
  resolveBundledSoundPath,
  type EnsureWavCacheOptions,
  type WavCacheResult,
} from "./wavCache.js";
export { resolveDataDirPath, resolveSoundsDirPath, type ResolveDataDirOptions } from "./dataDir.js";
export {
  selectAudioBackend,
  detectMpvPresent,
  detectNativePresent,
  isOnPath,
  type BackendProbe,
  type SelectAudioBackendOptions,
  type SelectedAudioBackend,
} from "./detect.js";

export {
  SidecarAudioBackend,
  PURRCODE_SIDECAR_BIN_ENV,
  PURRCODE_SIDECAR_NULL_ENV,
  encodeSidecarCommand,
  parseSidecarEventLine,
  isExecutableFile,
  resolveSidecarBinaryPath,
  sidecarPackageName,
} from "./sidecar/index.js";
export type {
  SidecarAudioBackendOptions,
  SidecarCommand,
  SidecarEvent,
  SidecarProtocolEventName,
  SidecarPlatform,
} from "./sidecar/index.js";
