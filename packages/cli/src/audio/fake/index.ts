export {
  FakeAudioBackend,
  PURRCODE_FAKE_AUDIO_ENV,
  PURRCODE_FAKE_AUDIO_LOG_ENV,
  isFakeAudioEnabled,
  resolveFakeAudioLogPath,
} from "./FakeAudioBackend.js";
export type { FakeAudioBackendOptions } from "./FakeAudioBackend.js";

export {
  FAKE_AUDIO_EVENT_TYPES,
  type FakeAudioEvent,
  type FakeAudioEventType,
  type SidecarEventName,
} from "./events.js";

export {
  assertContainsSequence,
  assertExactSequence,
  findEventSequence,
  readFakeAudioLog,
} from "./log.js";
