import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { ControlPipeClient, connectWithRetry } from "../control/client.js";
import { resolveControlPipePath } from "../control/paths.js";
import { PROTOCOL_VERSION } from "../control/protocol.js";

export type EnsureDaemonOptions = {
  /** Absolute path to the daemon entry module (ESM). Defaults to packaged cli entry. */
  entryPath?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  runtimeDir?: string;
  connectTimeoutMs?: number;
  spawnImpl?: typeof spawn;
};

export type EnsureDaemonResult =
  | { status: "already-running"; path: string }
  | { status: "spawned"; path: string; child: ChildProcess }
  | { status: "connected-after-spawn"; path: string };

/**
 * Ensure a daemon is reachable: connect, or spawn detached and connect-with-retry.
 * Socket bind remains the spawn mutex inside the daemon process (PC-104).
 */
export async function ensureDaemonRunning(
  options: EnsureDaemonOptions = {},
): Promise<EnsureDaemonResult> {
  const resolved = await resolveControlPipePath({
    ...(options.platform !== undefined ? { platform: options.platform } : {}),
    ...(options.env !== undefined ? { env: options.env } : {}),
    ...(options.runtimeDir !== undefined ? { runtimeDir: options.runtimeDir } : {}),
  });

  try {
    const socket = await connectWithRetry({
      path: resolved.path,
      timeoutMs: 150,
      retryDelayMs: 25,
    });
    socket.destroy();
    return { status: "already-running", path: resolved.path };
  } catch {
    // need spawn
  }

  const entry =
    options.entryPath ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "entry.js");
  const spawnImpl = options.spawnImpl ?? spawn;
  const child = spawnImpl(process.execPath, [entry], {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      ...options.env,
      PURRCODE_RUNTIME_DIR: resolved.runtimeDir,
    },
  });
  child.unref();

  const client = new ControlPipeClient({ path: resolved.path });
  try {
    await connectWithRetry({
      path: resolved.path,
      timeoutMs: options.connectTimeoutMs ?? 5000,
      retryDelayMs: 25,
    }).then((s) => s.destroy());
    // Prove protocol works
    await client.request({ v: PROTOCOL_VERSION, op: "status", id: "spawn-probe" }, 2000);
    client.close();
    return { status: "connected-after-spawn", path: resolved.path };
  } catch (err) {
    client.close();
    throw err;
  }
}
