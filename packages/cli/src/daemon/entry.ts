/**
 * Daemon process entry (PC-104). Invoked as `node …/daemon/entry.js`.
 * Honors PURRCODE_RUNTIME_DIR and PURRCODE_IDLE_MS.
 */
import { Daemon } from "./Daemon.js";

const idleMs = Number(process.env.PURRCODE_IDLE_MS ?? 1500);

const daemon = new Daemon({
  ...(process.env.PURRCODE_RUNTIME_DIR ? { runtimeDir: process.env.PURRCODE_RUNTIME_DIR } : {}),
  idleMs: Number.isFinite(idleMs) && idleMs > 0 ? idleMs : 1500,
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
