import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { ControlPipeClient } from "../control/client.js";
import { resolveControlPipePath } from "../control/paths.js";
import { PROTOCOL_VERSION } from "../control/protocol.js";

export type EnsureDaemonOptions = {
  /** Absolute path to the daemon entry module (ESM). Defaults to packaged cli entry. */
  entryPath?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  runtimeDir?: string;
  connectTimeoutMs?: number;
  /** Short probe used to detect an already-running daemon (default 150 ms). */
  probeTimeoutMs?: number;
  /** Windows pipe isolation (tests). Forwarded to the child via env. */
  windowsPipeSuffix?: string;
  spawnImpl?: typeof spawn;
};

export type EnsureDaemonResult = {
  status: "already-running" | "connected-after-spawn";
  path: string;
  /**
   * Live client that **holds the control connection** (FR-05 cold-start).
   * Caller must send the first message on this client, then {@link ControlPipeClient.close}.
   */
  client: ControlPipeClient;
};

/**
 * Ensure a daemon is reachable: connect, or spawn detached and connect-with-retry.
 * Socket bind remains the spawn mutex inside the daemon process (PC-104).
 *
 * Returns a **held** {@link ControlPipeClient} so idle-exit cannot win between
 * spawn and the first hook message (FR-05).
 */
export async function ensureDaemonRunning(
  options: EnsureDaemonOptions = {},
): Promise<EnsureDaemonResult> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...options.env,
  };
  if (options.windowsPipeSuffix) {
    env.PURRCODE_WINDOWS_PIPE_SUFFIX = options.windowsPipeSuffix;
  }

  const resolved = await resolveControlPipePath({
    ...(options.platform !== undefined ? { platform: options.platform } : {}),
    env,
    ...(options.runtimeDir !== undefined ? { runtimeDir: options.runtimeDir } : {}),
    ...(options.windowsPipeSuffix !== undefined
      ? { windowsPipeSuffix: options.windowsPipeSuffix }
      : {}),
  });

  const client = new ControlPipeClient({ path: resolved.path });
  const probeTimeoutMs = options.probeTimeoutMs ?? 150;

  try {
    await client.ensureConnected(probeTimeoutMs);
    await client.request({ v: PROTOCOL_VERSION, op: "status", id: "spawn-probe" }, 2000);
    return { status: "already-running", path: resolved.path, client };
  } catch {
    client.close();
  }

  const entry =
    options.entryPath ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "entry.js");
  const spawnImpl = options.spawnImpl ?? spawn;
  const child = spawnImpl(process.execPath, [entry], {
    detached: true,
    stdio: "ignore",
    env: {
      ...env,
      PURRCODE_RUNTIME_DIR: resolved.runtimeDir,
    },
  });
  child.unref();

  const spawned = new ControlPipeClient({ path: resolved.path });
  try {
    await spawned.ensureConnected(options.connectTimeoutMs ?? 5000);
    await spawned.request({ v: PROTOCOL_VERSION, op: "status", id: "spawn-probe" }, 2000);
    return { status: "connected-after-spawn", path: resolved.path, client: spawned };
  } catch (err) {
    spawned.close();
    throw err;
  }
}
