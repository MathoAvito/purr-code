import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { ControlPipeClient } from "../control/client.js";
import { resolveControlPipePath } from "../control/paths.js";
import { PROTOCOL_VERSION } from "../control/protocol.js";
import { resolveRuntimeDirPath } from "../runtime/resolveRuntimeDir.js";
import { readPidfile, removePidfile } from "../daemon/pidfile.js";
import { style } from "../cli/style.js";
import { createClaudePluginOps, type ClaudePluginOps } from "./claudePlugin.js";
import {
  MARKETPLACE_NAME,
  PLUGIN_ID,
  expectedPluginDataDir,
  findCachedPluginRoot,
} from "./paths.js";
import { removeStableMarketplace } from "./stableMarketplace.js";

export type UninstallFlags = {
  keepData?: boolean;
  purge?: boolean;
  /** Also remove the local purrcode marketplace registration (default true). */
  removeMarketplace?: boolean;
};

export type UninstallOptions = UninstallFlags & {
  env?: NodeJS.ProcessEnv;
  home?: string;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
  claude?: ClaudePluginOps;
  /** Inject daemon stop (tests). */
  stopDaemon?: (opts: { env: NodeJS.ProcessEnv; home: string }) => Promise<string[]>;
  /** Inject runtime dir removal (tests). */
  removeRuntime?: (runtimeDir: string) => Promise<string[]>;
  /** Inject plugin-data removal (tests). */
  removePluginData?: (pluginData: string, flags: UninstallFlags) => Promise<string[]>;
};

export type UninstallResult = {
  exitCode: number;
  removed: string[];
  alreadyClean: boolean;
};

/**
 * `purrcode uninstall` — clean plugin removal (PC-403 / §8).
 *
 * Flags:
 * - default: remove plugin + plugin data + runtime/daemon
 * - `--keep-data`: preserve `${CLAUDE_PLUGIN_DATA}` (maps to `claude plugin uninstall --keep-data`)
 * - `--purge`: also remove imported-audio dir when present (Phase 2 surface; mechanism ships now)
 */
export async function runUninstall(options: UninstallOptions = {}): Promise<UninstallResult> {
  const env = options.env ?? process.env;
  const home = options.home ?? (env.HOME?.trim() || homedir());
  const out = options.stdout ?? ((line: string) => process.stdout.write(`${line}\n`));
  const err = options.stderr ?? ((line: string) => process.stderr.write(`${line}\n`));
  const claude = options.claude ?? createClaudePluginOps({ env });
  const flags: UninstallFlags = {
    keepData: options.keepData ?? false,
    purge: options.purge ?? false,
    removeMarketplace: options.removeMarketplace ?? true,
  };

  const removed: string[] = [];
  out(style.bold("🐈 Uninstalling PurrCode", env));
  out("");

  // 1. Stop daemon (fade via shutdown) + clear runtime
  const stopDaemon = options.stopDaemon ?? defaultStopDaemon;
  const removeRuntime = options.removeRuntime ?? defaultRemoveRuntime;
  try {
    const daemonRemoved = await stopDaemon({ env, home });
    removed.push(...daemonRemoved);
    if (daemonRemoved.length) {
      out(style.ok("✓ Stopped player daemon (fade + exit)", env));
    } else {
      out(style.ok("✓ No running daemon", env));
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    err(style.warn(`⚠ Daemon stop incomplete: ${msg}`, env));
  }

  const runtimeDir = resolveRuntimeDirPath({ env });
  try {
    const rtRemoved = await removeRuntime(runtimeDir);
    removed.push(...rtRemoved);
    if (rtRemoved.length) {
      out(style.ok("✓ Removed runtime state (socket, pidfile, registry)", env));
      out(style.dim(`  ${runtimeDir}`, env));
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    err(style.warn(`⚠ Runtime cleanup incomplete: ${msg}`, env));
  }

  // 2. Uninstall plugin (idempotent)
  let pluginWasInstalled: boolean;
  try {
    const installed = await claude.pluginList();
    pluginWasInstalled = installed.some(
      (id) => id === PLUGIN_ID || id.startsWith("purrcode@") || id === "purrcode",
    );
  } catch {
    pluginWasInstalled = false;
  }

  if (pluginWasInstalled) {
    try {
      await claude.pluginUninstall(PLUGIN_ID, { keepData: flags.keepData === true });
      removed.push(`plugin:${PLUGIN_ID}`);
      out(
        style.ok(
          flags.keepData
            ? `✓ Removed plugin ${PLUGIN_ID} (kept plugin data)`
            : `✓ Removed plugin ${PLUGIN_ID}`,
          env,
        ),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      err(style.err(`✗ Plugin uninstall failed: ${msg}`, env));
      err(style.dim(`Fix: run \`claude plugin uninstall ${PLUGIN_ID}\`.`, env));
      return { exitCode: 1, removed, alreadyClean: false };
    }
  } else {
    out(style.ok(`✓ Plugin not installed (${PLUGIN_ID})`, env));
  }

  // 3. Marketplace removal (optional, default on)
  if (flags.removeMarketplace) {
    try {
      const markets = await claude.marketplaceList();
      if (markets.includes(MARKETPLACE_NAME)) {
        await claude.marketplaceRemove(MARKETPLACE_NAME);
        removed.push(`marketplace:${MARKETPLACE_NAME}`);
        out(style.ok(`✓ Removed marketplace (${MARKETPLACE_NAME})`, env));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      err(style.warn(`⚠ Marketplace remove skipped: ${msg}`, env));
    }
  }

  // 3b. Stable marketplace copy (registration artifact, not user data — always removed)
  try {
    const stableRemoved = await removeStableMarketplace({ env, home });
    if (stableRemoved) {
      removed.push(`marketplace-files:${stableRemoved}`);
      out(style.ok("✓ Removed marketplace files", env));
      out(style.dim(`  ${stableRemoved}`, env));
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    err(style.warn(`⚠ Marketplace files cleanup incomplete: ${msg}`, env));
  }

  // 4. Plugin data / imported audio
  const pluginData = expectedPluginDataDir(home);
  const removePluginData = options.removePluginData ?? defaultRemovePluginData;
  try {
    const dataRemoved = await removePluginData(pluginData, flags);
    removed.push(...dataRemoved);
    if (dataRemoved.some((r) => r.startsWith("plugin-data:"))) {
      out(style.ok("✓ Removed plugin data", env));
      out(style.dim(`  ${pluginData}`, env));
    } else if (flags.keepData && existsSync(pluginData)) {
      out(style.ok("✓ Kept plugin data (--keep-data)", env));
      out(style.dim(`  ${pluginData}`, env));
    }
    if (dataRemoved.some((r) => r.startsWith("imported:"))) {
      out(style.ok("✓ Purged imported audio (--purge)", env));
    } else if (flags.purge && flags.keepData) {
      out(style.dim("  (--purge: no imported audio directory present)", env));
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    err(style.warn(`⚠ Plugin data cleanup incomplete: ${msg}`, env));
  }

  // Cache leftover (best-effort)
  const cacheRoot = findCachedPluginRoot(home);
  if (cacheRoot) {
    try {
      await rm(join(home, ".claude", "plugins", "cache", "purrcode"), {
        recursive: true,
        force: true,
      });
      removed.push("plugin-cache:purrcode");
      out(style.ok("✓ Cleared plugin cache", env));
    } catch {
      // ignore
    }
  }

  out("");
  if (removed.length === 0 && !pluginWasInstalled) {
    out("Nothing to remove — already clean.");
    return { exitCode: 0, removed, alreadyClean: true };
  }
  out(`Removed ${removed.length} item(s).`);
  for (const item of removed) {
    out(style.dim(`  - ${item}`, env));
  }
  return { exitCode: 0, removed, alreadyClean: false };
}

export function parseUninstallArgs(
  argv: string[],
): UninstallFlags & { ok: boolean; error?: string } {
  const flags: UninstallFlags = {};
  for (const arg of argv) {
    if (arg === "--keep-data") flags.keepData = true;
    else if (arg === "--purge") flags.purge = true;
    else if (arg === "--keep-marketplace") flags.removeMarketplace = false;
    else if (arg.startsWith("-")) {
      return { ok: false, error: `Unknown flag: ${arg}` };
    } else {
      return { ok: false, error: `Unexpected argument: ${arg}` };
    }
  }
  return { ok: true, ...flags };
}

async function defaultStopDaemon(opts: {
  env: NodeJS.ProcessEnv;
  home: string;
}): Promise<string[]> {
  void opts.home;
  const removed: string[] = [];
  const runtimeDir = resolveRuntimeDirPath({ env: opts.env });

  try {
    const endpoint = await resolveControlPipePath({
      runtimeDir,
      platform: process.platform,
      env: opts.env,
    });
    const client = new ControlPipeClient({ path: endpoint.path, connectTimeoutMs: 400 });
    await client.ensureConnected(400);
    // Fire-and-forget: daemon may close the socket before a reply.
    await client.send({
      v: PROTOCOL_VERSION,
      op: "shutdown",
      id: randomUUID(),
    });
    client.close();
    removed.push("daemon:shutdown");
    await new Promise((r) => setTimeout(r, 800));
  } catch {
    // Not running — fall through to pid kill
  }

  const pid = readPidfile(runtimeDir);
  if (pid !== null) {
    try {
      process.kill(pid, 0);
      process.kill(pid, "SIGTERM");
      removed.push(`daemon:pid:${pid}`);
      await new Promise((r) => setTimeout(r, 200));
    } catch {
      // already dead
    }
    removePidfile(runtimeDir);
  }
  return removed;
}

async function defaultRemoveRuntime(runtimeDir: string): Promise<string[]> {
  if (!existsSync(runtimeDir)) return [];
  await rm(runtimeDir, { recursive: true, force: true });
  return [`runtime:${runtimeDir}`];
}

async function defaultRemovePluginData(
  pluginData: string,
  flags: UninstallFlags,
): Promise<string[]> {
  const removed: string[] = [];
  const importedDir = join(pluginData, "imported");

  if (flags.keepData) {
    if (flags.purge && existsSync(importedDir)) {
      await rm(importedDir, { recursive: true, force: true });
      removed.push(`imported:${importedDir}`);
    }
    return removed;
  }

  // Default: claude uninstall already deletes data unless --keep-data.
  // Remove ourselves too for idempotency when plugin was already gone.
  if (existsSync(pluginData)) {
    await rm(pluginData, { recursive: true, force: true });
    removed.push(`plugin-data:${pluginData}`);
  }
  return removed;
}
