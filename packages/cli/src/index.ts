/**
 * PurrCode — hook adapter, CLI, and per-user player daemon.
 *
 * Subsystems land story by story (see docs/planning/): hook adapter (PC-107),
 * daemon core (PC-104), session registry (PC-105), audio backends (PC-101,
 * PC-301+). This entry point only carries what already exists.
 */

/** Hook events PurrCode reacts to, verified against Claude Code in ADR 0001. */
export const HOOK_EVENTS = ["UserPromptSubmit", "Stop", "StopFailure", "SessionEnd"] as const;

export type HookEvent = (typeof HOOK_EVENTS)[number];

export function isHookEvent(value: string): value is HookEvent {
  return (HOOK_EVENTS as readonly string[]).includes(value);
}

export type {
  AudioBackend,
  BackendCapabilities,
  BackendTier,
  PlaybackOptions,
  PlayerHandle,
} from "./audio/types.js";

export {
  FAKE_AUDIO_EVENT_TYPES,
  FakeAudioBackend,
  PURRCODE_FAKE_AUDIO_ENV,
  PURRCODE_FAKE_AUDIO_LOG_ENV,
  assertContainsSequence,
  assertExactSequence,
  findEventSequence,
  isFakeAudioEnabled,
  readFakeAudioLog,
  resolveFakeAudioLogPath,
} from "./audio/fake/index.js";
export type {
  FakeAudioBackendOptions,
  FakeAudioEvent,
  FakeAudioEventType,
  SidecarEventName,
} from "./audio/fake/index.js";
export {
  SidecarAudioBackend,
  PURRCODE_SIDECAR_BIN_ENV,
  PURRCODE_SIDECAR_NULL_ENV,
  encodeSidecarCommand,
  parseSidecarEventLine,
  resolveSidecarBinaryPath,
  sidecarPackageName,
} from "./audio/sidecar/index.js";
export type {
  SidecarAudioBackendOptions,
  SidecarCommand,
  SidecarEvent,
  SidecarProtocolEventName,
} from "./audio/sidecar/index.js";
export { NoneAudioBackend } from "./audio/none/NoneAudioBackend.js";
export { MpvAudioBackend } from "./audio/mpv/index.js";
export type { MpvAudioBackendOptions } from "./audio/mpv/index.js";
export {
  selectAudioBackend,
  detectMpvPresent,
  detectNativePresent,
  isOnPath,
} from "./audio/detect.js";
export type {
  BackendProbe,
  SelectAudioBackendOptions,
  SelectedAudioBackend,
} from "./audio/detect.js";
export {
  applyVolumeForTier,
  clampPerceptualVolume,
  interpolatePerceptualVolume,
  perceptualToGainDb,
  perceptualToLinearAmplitude,
  samplePerceptualRamp,
} from "./audio/perceptual.js";
export type { VolumeApplication } from "./audio/perceptual.js";

export { RuntimeDirError, ensureRuntimeDir, resolveRuntimeDirPath } from "./runtime/index.js";
export type {
  EnsureRuntimeDirOptions,
  ResolveRuntimeDirOptions,
  RuntimeDirErrorCode,
  RuntimeDirFs,
} from "./runtime/index.js";

export {
  ALL_OPS,
  ControlPipeClient,
  ControlPipeServer,
  FIRE_AND_FORGET_OPS,
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  REQUEST_OPS,
  connectWithRetry,
  encodeControlMessage,
  isFireAndForget,
  isRequestOp,
  parseControlMessage,
  resolveControlPipePath,
  resolveWindowsPipeSuffix,
  writeFully,
} from "./control/index.js";
export type {
  ConnectWithRetryOptions,
  ControlMessageHandler,
  ControlOp,
  ControlPipeClientOptions,
  ControlPipeServerOptions,
  ControlRequest,
  ControlResponse,
  FireAndForgetOp,
  ListenResult,
  RequestOp,
  ResolveControlPipeOptions,
} from "./control/index.js";

export {
  Daemon,
  DEFAULT_STALE_SESSION_MS,
  DEFAULT_WATCHDOG_INTERVAL_MS,
  applyWatchdogTick,
  reconcileRegistry,
  ensureDaemonRunning,
  pidfilePath,
  readPidfile,
  removePidfile,
  writePidfile,
} from "./daemon/index.js";
export type {
  ApplyWatchdogOptions,
  DaemonOptions,
  EnsureDaemonOptions,
  EnsureDaemonResult,
  ReconcileOptions,
  ReconcileResult,
  WatchdogClassify,
  WatchdogTickResult,
} from "./daemon/index.js";

export { PlaybackController, SessionRegistry } from "./session/index.js";
export type {
  PlaybackControllerOptions,
  PlaybackPhase,
  SessionRecord,
  SessionStartInput,
} from "./session/index.js";
export {
  SNAPSHOT_VERSION,
  filterLiveSessions,
  loadRegistrySnapshot,
  snapshotPath,
  writeRegistrySnapshot,
} from "./session/index.js";
export type { LoadSnapshotResult, RegistrySnapshot } from "./session/index.js";

export { parseHookStdin, readStarttimeToken, runHook, shouldSuppressHooks } from "./hook/index.js";
export type { HookEventName, HookPayload, ParseHookResult, RunHookOptions } from "./hook/index.js";

export {
  CONFIG_SCHEMA_VERSION,
  DEFAULT_CONFIG,
  applyConfigPatch,
  loadConfig,
  mergeConfig,
  normalizeConfig,
  resolveConfigDirPath,
  resolveConfigFilePath,
  writeConfig,
} from "./config/index.js";
export type { LoadConfigResult, PurrCodeConfig, ResolveConfigDirOptions } from "./config/index.js";

export {
  classifyProcess,
  parseLinuxStat,
  parsePsPidStateLstart,
  primaryStateLetter,
  readProcessSnapshot,
  readProcessSnapshots,
} from "./process/index.js";
export type {
  ClassifyOptions,
  ProcessIdentity,
  ProcessLiveness,
  ProcessSnapshot,
} from "./process/index.js";

export {
  PURRCODE_LOG_ENV,
  debugLog,
  defaultDebugLogPath,
  hashSessionId,
  isDebugLogEnabled,
} from "./log/index.js";
export type { DebugLogFields } from "./log/index.js";
