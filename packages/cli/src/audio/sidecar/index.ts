export {
  SidecarAudioBackend,
  PURRCODE_SIDECAR_BIN_ENV,
  PURRCODE_SIDECAR_NULL_ENV,
  type SidecarAudioBackendOptions,
} from "./SidecarAudioBackend.js";

export {
  encodeSidecarCommand,
  parseSidecarEventLine,
  type SidecarCommand,
  type SidecarEvent,
  type SidecarProtocolEventName,
} from "./protocol.js";

export {
  isExecutableFile,
  resolveSidecarBinaryPath,
  sidecarPackageName,
  type SidecarPlatform,
} from "./resolveBinary.js";
