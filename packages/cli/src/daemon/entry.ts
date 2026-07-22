/**
 * Daemon process entry (PC-104 / PC-302). Invoked as `node …/daemon/entry.js`.
 * Honors PURRCODE_RUNTIME_DIR, PURRCODE_IDLE_MS, and PURRCODE_FAKE_AUDIO.
 * Selects an audio backend once at boot (cached for the process lifetime).
 */
import { Daemon } from "./Daemon.js";
import { selectAudioBackend } from "../audio/detect.js";
import { MpvAudioBackend } from "../audio/mpv/index.js";
import { NativeAudioBackend } from "../audio/native/index.js";

const idleMs = Number(process.env.PURRCODE_IDLE_MS ?? 1500);

const selected = await selectAudioBackend({
  env: process.env,
  createMpv: () => new MpvAudioBackend({ env: process.env }),
  createNative: () => new NativeAudioBackend({ env: process.env }),
});

const daemon = new Daemon({
  ...(process.env.PURRCODE_RUNTIME_DIR ? { runtimeDir: process.env.PURRCODE_RUNTIME_DIR } : {}),
  idleMs: Number.isFinite(idleMs) && idleMs > 0 ? idleMs : 1500,
  audioBackend: selected.backend,
  backendCapabilities: selected.capabilities,
  backendProbes: selected.probes,
  onIdleExit: () => process.exit(0),
});

const result = await daemon.start();
if (result.status === "lost-race") {
  process.exit(0);
}

const stop = () => {
  void daemon.shutdown("signal").then(() => process.exit(0));
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
