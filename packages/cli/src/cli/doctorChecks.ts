import { constants, existsSync, lstatSync, readFileSync } from "node:fs";
import { access, mkdir, writeFile, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { isOnPath, selectAudioBackend, type SelectAudioBackendOptions } from "../audio/detect.js";
import { resolveBundledSoundPath, ensureWavCache } from "../audio/wavCache.js";
import { loadConfig, resolveConfigDirPath, type ResolveConfigDirOptions } from "../config/index.js";
import { ensureDaemonRunning } from "../daemon/spawn.js";
import { PROTOCOL_VERSION } from "../control/protocol.js";
import { shouldSuppressHooks } from "../hook/parse.js";
import { resolveRuntimeDirPath } from "../runtime/resolveRuntimeDir.js";
import { loadRegistrySnapshot } from "../session/snapshot.js";
import type { DoctorCheck, DoctorReport } from "./doctorTypes.js";

const execFileAsync = promisify(execFile);

export type SettingsScope = {
  label: string;
  path: string;
};

export type DoctorDeps = {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  home: string;
  /** Project root for project/local settings (optional). */
  cwd?: string;
  configDir?: ResolveConfigDirOptions;
  /** Override settings scopes (tests). */
  settingsScopes?: SettingsScope[];
  selectBackend?: (opts: SelectAudioBackendOptions) => ReturnType<typeof selectAudioBackend>;
  ensureDaemon?: typeof ensureDaemonRunning;
  /** Inject Claude version probe (tests). */
  probeClaude?: () => Promise<{ present: boolean; version?: string; detail?: string }>;
  /** Injectable ownership check for runtime dir (tests). */
  checkRuntimeOwnership?: (path: string) => Promise<{ ok: boolean; detail: string }>;
};

const PURR_HOOK_HINT = /purrcode|purr-code|hook\.js|purrcode-hook/i;

/** Collect FR-10 doctor checks (PC-307). */
export async function collectDoctorChecks(deps: DoctorDeps): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];

  checks.push(checkPlatform(deps.platform));
  checks.push(await checkClaude(deps));
  const scopes = deps.settingsScopes ?? defaultSettingsScopes(deps);
  checks.push(...checkSettingsValidity(scopes));
  checks.push(...checkDisableAllHooks(scopes));
  checks.push(...checkInstallMode(scopes, deps));
  checks.push(...checkHookResolution(scopes));
  checks.push(checkSuppression(deps.env));
  checks.push(await checkBackend(deps));
  checks.push(await checkConfigWritable(deps));
  checks.push(await checkRuntimeDir(deps));
  checks.push(await checkDaemon(deps));
  checks.push(await checkSound(deps));

  const healthy = !checks.some((c) => c.status === "fail");
  return {
    checks,
    healthy,
    exitCode: healthy ? 0 : 1,
    verdict: healthy
      ? "The cat appears healthy."
      : "The cat needs attention — see failed checks above.",
  };
}

export function defaultSettingsScopes(deps: DoctorDeps): SettingsScope[] {
  const home = deps.home;
  const cwd = deps.cwd ?? process.cwd();
  const scopes: SettingsScope[] = [
    { label: "user", path: join(home, ".claude", "settings.json") },
    { label: "project", path: join(cwd, ".claude", "settings.json") },
    { label: "local", path: join(cwd, ".claude", "settings.local.json") },
  ];
  // Common managed/policy locations (best-effort; may not exist).
  if (deps.platform === "darwin") {
    scopes.push({
      label: "managed",
      path: "/Library/Application Support/ClaudeCode/managed-settings.json",
    });
  } else if (deps.platform === "linux") {
    scopes.push({ label: "managed", path: "/etc/claude-code/managed-settings.json" });
  }
  return scopes;
}

function checkPlatform(platform: NodeJS.Platform): DoctorCheck {
  if (platform === "darwin" || platform === "linux" || platform === "win32") {
    return {
      id: "platform",
      status: "ok",
      summary: `Platform supported (${platform})`,
    };
  }
  return {
    id: "platform",
    status: "fail",
    summary: `Unsupported platform: ${platform}`,
    fix: "PurrCode supports macOS, Linux, and Windows. Run on one of those.",
  };
}

async function checkClaude(deps: DoctorDeps): Promise<DoctorCheck> {
  if (deps.probeClaude) {
    const r = await deps.probeClaude();
    if (r.present) {
      return {
        id: "claude",
        status: "ok",
        summary: `Claude Code detected${r.version ? ` (${r.version})` : ""}`,
      };
    }
    return {
      id: "claude",
      status: "fail",
      summary: r.detail ?? "Claude Code not found on PATH",
      fix: "Install Claude Code (https://code.claude.com) and ensure `claude` is on your PATH.",
    };
  }

  if (!isOnPath("claude", deps.env)) {
    return {
      id: "claude",
      status: "fail",
      summary: "Claude Code not found on PATH",
      fix: "Install Claude Code and ensure the `claude` binary is on your PATH.",
    };
  }
  try {
    const { stdout, stderr } = await execFileAsync("claude", ["--version"], {
      env: deps.env,
      timeout: 5000,
      maxBuffer: 64 * 1024,
    });
    const text = `${stdout}${stderr}`.trim().split("\n")[0] ?? "claude";
    return {
      id: "claude",
      status: "ok",
      summary: `Claude Code detected (${text})`,
    };
  } catch {
    return {
      id: "claude",
      status: "warn",
      summary: "`claude` is on PATH but --version failed",
      fix: "Reinstall Claude Code or check that the binary runs.",
    };
  }
}

function readJsonFile(path: string): { ok: true; value: unknown } | { ok: false; reason: string } {
  if (!existsSync(path)) return { ok: false, reason: "missing" };
  try {
    if (lstatSync(path).isSymbolicLink()) return { ok: false, reason: "symlink" };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  try {
    return { ok: true, value: JSON.parse(readFileSync(path, "utf8")) as unknown };
  } catch {
    return { ok: false, reason: "invalid-json" };
  }
}

function checkSettingsValidity(scopes: SettingsScope[]): DoctorCheck[] {
  const out: DoctorCheck[] = [];
  for (const scope of scopes) {
    if (!existsSync(scope.path)) continue;
    const parsed = readJsonFile(scope.path);
    if (!parsed.ok) {
      out.push({
        id: `settings-${scope.label}`,
        status: "fail",
        summary: `${scope.label} settings invalid (${parsed.reason}): ${scope.path}`,
        fix: `Fix or remove the broken JSON at ${scope.path}, then retry.`,
      });
    }
  }
  if (out.length === 0) {
    out.push({
      id: "settings",
      status: "ok",
      summary: "Settings files present are valid JSON",
    });
  }
  return out;
}

function checkDisableAllHooks(scopes: SettingsScope[]): DoctorCheck[] {
  const hits: string[] = [];
  for (const scope of scopes) {
    const parsed = readJsonFile(scope.path);
    if (!parsed.ok || typeof parsed.value !== "object" || parsed.value === null) continue;
    const obj = parsed.value as Record<string, unknown>;
    if (obj.disableAllHooks === true) hits.push(scope.label);
  }
  if (hits.length === 0) {
    return [
      {
        id: "disableAllHooks",
        status: "ok",
        summary: "disableAllHooks is not set",
      },
    ];
  }
  return [
    {
      id: "disableAllHooks",
      status: "fail",
      summary: `disableAllHooks is true in: ${hits.join(", ")}`,
      fix: "Set disableAllHooks to false (or remove it) in the listed settings scope(s). Purr hooks cannot fire while it is true.",
    },
  ];
}

function countPurrHooksInSettings(value: unknown): number {
  if (typeof value !== "object" || value === null) return 0;
  const hooks = (value as { hooks?: unknown }).hooks;
  if (typeof hooks !== "object" || hooks === null) return 0;
  let count = 0;
  for (const groups of Object.values(hooks as Record<string, unknown>)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      if (typeof group !== "object" || group === null) continue;
      const list = (group as { hooks?: unknown }).hooks;
      if (!Array.isArray(list)) continue;
      for (const h of list) {
        const blob = JSON.stringify(h);
        if (PURR_HOOK_HINT.test(blob)) count += 1;
      }
    }
  }
  return count;
}

function checkInstallMode(scopes: SettingsScope[], deps: DoctorDeps): DoctorCheck[] {
  let settingsHookCount = 0;
  let pluginEnabled = false;
  for (const scope of scopes) {
    const parsed = readJsonFile(scope.path);
    if (!parsed.ok || typeof parsed.value !== "object" || parsed.value === null) continue;
    const obj = parsed.value as Record<string, unknown>;
    settingsHookCount += countPurrHooksInSettings(obj);
    const enabled = obj.enabledPlugins;
    if (typeof enabled === "object" && enabled !== null) {
      const enabledObj = enabled as Record<string, unknown>;
      for (const key of Object.keys(enabledObj)) {
        if (/purrcode/i.test(key) && enabledObj[key] === true) {
          pluginEnabled = true;
        }
      }
    }
  }

  const installedPath = join(deps.home, ".claude", "plugins", "installed_plugins.json");
  const installed = readJsonFile(installedPath);
  let pluginInstalled = false;
  if (installed.ok && typeof installed.value === "object" && installed.value !== null) {
    const plugins = (installed.value as { plugins?: unknown }).plugins;
    if (typeof plugins === "object" && plugins !== null) {
      const pluginsObj = plugins as Record<string, unknown>;
      for (const key of Object.keys(pluginsObj)) {
        if (/purrcode/i.test(key)) pluginInstalled = true;
      }
    }
  }

  const checks: DoctorCheck[] = [];
  if (pluginInstalled || pluginEnabled) {
    checks.push({
      id: "install-mode",
      status: pluginEnabled || pluginInstalled ? "ok" : "warn",
      summary: pluginEnabled
        ? "Installation mode: Claude Code plugin (enabled)"
        : "Installation mode: Claude Code plugin (installed; check enable state)",
    });
  } else if (settingsHookCount > 0) {
    checks.push({
      id: "install-mode",
      status: "ok",
      summary: `Installation mode: direct hooks in settings (${settingsHookCount} purr hook entries)`,
    });
  } else {
    checks.push({
      id: "install-mode",
      status: "warn",
      summary: "No PurrCode plugin or settings hooks detected",
      fix: "Run `purrcode install` (or `npx purr-code install`) to register the Claude Code plugin.",
    });
  }

  if (pluginInstalled && settingsHookCount > 0) {
    checks.push({
      id: "hook-duplication",
      status: "warn",
      summary: "Purr hooks appear in both plugin and settings.json (possible duplication)",
      fix: "Prefer the plugin path and remove PurrCode entries from settings.json to avoid double start/stop.",
    });
  } else {
    checks.push({
      id: "hook-duplication",
      status: "ok",
      summary: "No plugin+settings hook duplication detected",
    });
  }

  return checks;
}

/** §20: hook command fails to resolve → transcript errors. */
function checkHookResolution(scopes: SettingsScope[]): DoctorCheck[] {
  const problems: string[] = [];
  for (const scope of scopes) {
    const parsed = readJsonFile(scope.path);
    if (!parsed.ok || typeof parsed.value !== "object" || parsed.value === null) continue;
    const hooks = (parsed.value as { hooks?: unknown }).hooks;
    if (typeof hooks !== "object" || hooks === null) continue;
    for (const groups of Object.values(hooks as Record<string, unknown>)) {
      if (!Array.isArray(groups)) continue;
      for (const group of groups) {
        if (typeof group !== "object" || group === null) continue;
        const list = (group as { hooks?: unknown }).hooks;
        if (!Array.isArray(list)) continue;
        for (const h of list) {
          if (typeof h !== "object" || h === null) continue;
          const hook = h as Record<string, unknown>;
          const blob = JSON.stringify(hook);
          if (!PURR_HOOK_HINT.test(blob)) continue;
          const command = typeof hook.command === "string" ? hook.command : "";
          if (command === "npx" || /\bnpx\b/.test(command)) {
            problems.push(`${scope.label}: uses npx (forbidden on hook path)`);
          }
          // String-form without args array is fragile (shell / PATH).
          if (command.includes(" ") && !Array.isArray(hook.args)) {
            problems.push(`${scope.label}: string-form hook command (prefer exec form)`);
          }
          const args = Array.isArray(hook.args) ? hook.args : [];
          for (const arg of args) {
            if (typeof arg !== "string") continue;
            if (arg.includes("${CLAUDE_PLUGIN_ROOT}")) continue; // resolved by Claude at runtime
            if (arg.startsWith("/") || /^[A-Za-z]:[\\/]/.test(arg)) {
              if (!existsSync(arg)) {
                problems.push(`${scope.label}: missing hook path ${arg}`);
              }
            }
          }
        }
      }
    }
  }

  if (problems.length === 0) {
    return [
      {
        id: "hook-resolution",
        status: "ok",
        summary: "Purr hook commands look resolvable (or none configured)",
      },
    ];
  }
  return [
    {
      id: "hook-resolution",
      status: "fail",
      summary: `Hook resolution problems: ${problems.slice(0, 3).join("; ")}${problems.length > 3 ? "…" : ""}`,
      fix: "Use exec-form hooks with absolute paths or ${CLAUDE_PLUGIN_ROOT}; never npx/PATH. Fix or reinstall PurrCode hooks.",
    },
  ];
}

function checkSuppression(env: NodeJS.ProcessEnv): DoctorCheck {
  if (!shouldSuppressHooks(env)) {
    return {
      id: "suppression",
      status: "ok",
      summary: "Hooks are not suppressed by CI/remote env vars",
    };
  }
  const reasons: string[] = [];
  if (env.CI === "true" || env.CI === "1") reasons.push("CI");
  if (env.CLAUDE_CODE_REMOTE === "true") reasons.push("CLAUDE_CODE_REMOTE=true");
  if (env.CLAUDE_CODE_ENTRYPOINT === "sdk-cli") reasons.push("CLAUDE_CODE_ENTRYPOINT=sdk-cli");
  return {
    id: "suppression",
    status: "warn",
    summary: `Hook suppression active (${reasons.join(", ") || "env"})`,
    fix: "Unset CI / CLAUDE_CODE_REMOTE (and avoid sdk-cli entrypoint) in interactive sessions if you want the purr to run.",
  };
}

async function checkBackend(deps: DoctorDeps): Promise<DoctorCheck> {
  const select = deps.selectBackend ?? selectAudioBackend;
  const selected = await select({ env: deps.env, platform: deps.platform });
  const c = selected.capabilities;
  if (!c.available || c.tier === "none") {
    return {
      id: "backend",
      status: "fail",
      summary: "No audio backend available (tier none)",
      fix: "Build/install the bundled sidecar, or install mpv, or ensure afplay/paplay/aplay/PowerShell is available.",
    };
  }
  const caps = `loop=${c.loop} fade=${c.fade} runtimeVolume=${c.runtimeVolume}`;
  return {
    id: "backend",
    status: c.tier === "native" ? "warn" : "ok",
    summary: `Audio backend: ${c.name} (tier ${c.tier} — ${caps})`,
    ...(c.tier === "native"
      ? {
          fix: "Tier-3 uses seamed loops and hard stops. Install the sidecar or mpv for fades and gapless looping.",
        }
      : {}),
  };
}

async function checkConfigWritable(deps: DoctorDeps): Promise<DoctorCheck> {
  const opts: ResolveConfigDirOptions = {
    platform: deps.platform,
    env: deps.env,
    home: deps.home,
    ...deps.configDir,
  };
  const dir = resolveConfigDirPath(opts);
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const probe = join(dir, `.doctor-write-${process.pid}`);
    await writeFile(probe, "ok", { encoding: "utf8", mode: 0o600 });
    await unlink(probe);
    return {
      id: "config-dir",
      status: "ok",
      summary: `Config directory writable (${dir})`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      id: "config-dir",
      status: "fail",
      summary: `Config directory not writable (${dir})`,
      fix: `Ensure you own ${dir} and can create files there (${msg}).`,
    };
  }
}

async function checkRuntimeDir(deps: DoctorDeps): Promise<DoctorCheck> {
  let path: string;
  try {
    path = resolveRuntimeDirPath({
      platform: deps.platform,
      env: deps.env,
    });
  } catch (e) {
    return {
      id: "runtime-dir",
      status: "fail",
      summary: "Cannot resolve runtime directory",
      fix: e instanceof Error ? e.message : String(e),
    };
  }

  if (deps.checkRuntimeOwnership) {
    const own = await deps.checkRuntimeOwnership(path);
    if (!own.ok) {
      return {
        id: "runtime-dir",
        status: "fail",
        summary: `Runtime directory ownership/security problem: ${own.detail}`,
        fix: `Remove or reclaim ${path} so it is a 0700 directory owned by you, then retry.`,
      };
    }
  } else if (existsSync(path) && deps.platform !== "win32") {
    try {
      const st = lstatSync(path);
      if (st.isSymbolicLink()) {
        return {
          id: "runtime-dir",
          status: "fail",
          summary: `Runtime directory is a symlink: ${path}`,
          fix: `Remove the symlink and let PurrCode recreate ${path} as a real 0700 directory.`,
        };
      }
      const uid = process.getuid?.();
      if (uid !== undefined && st.uid !== uid) {
        return {
          id: "runtime-dir",
          status: "fail",
          summary: `Runtime directory not owned by you: ${path}`,
          fix: `chown the directory to your user or delete it so PurrCode can recreate it.`,
        };
      }
      if ((st.mode & 0o077) !== 0) {
        return {
          id: "runtime-dir",
          status: "fail",
          summary: `Runtime directory has group/other permissions: ${path}`,
          fix: `chmod 700 ${path}`,
        };
      }
    } catch (e) {
      return {
        id: "runtime-dir",
        status: "fail",
        summary: `Cannot inspect runtime directory: ${path}`,
        fix: e instanceof Error ? e.message : String(e),
      };
    }
  }

  try {
    await mkdir(path, { recursive: true, mode: 0o700 });
    await access(path, constants.W_OK);
    return {
      id: "runtime-dir",
      status: "ok",
      summary: `Runtime directory writable and owned by you (${path})`,
    };
  } catch (e) {
    return {
      id: "runtime-dir",
      status: "fail",
      summary: `Runtime directory not writable: ${path}`,
      fix: e instanceof Error ? e.message : String(e),
    };
  }
}

async function checkDaemon(deps: DoctorDeps): Promise<DoctorCheck> {
  const ensure = deps.ensureDaemon ?? ensureDaemonRunning;
  try {
    const { client } = await ensure({ env: deps.env });
    try {
      const res = await client.request({
        v: PROTOCOL_VERSION,
        op: "status",
        id: "doctor-status",
      });
      if (!res.ok || !res.result || typeof res.result !== "object") {
        return {
          id: "daemon",
          status: "fail",
          summary: "Daemon reachable but status failed",
          fix: "Restart with `purrcode status` or kill the stale pidfile under the runtime dir.",
        };
      }
      const st = res.result as Record<string, unknown>;
      const paused = typeof st.pausedSessions === "number" ? st.pausedSessions : 0;
      const runtimeDir =
        typeof deps.env.PURRCODE_RUNTIME_DIR === "string" && deps.env.PURRCODE_RUNTIME_DIR
          ? deps.env.PURRCODE_RUNTIME_DIR
          : resolveRuntimeDirPath({ platform: deps.platform, env: deps.env });
      const snap = loadRegistrySnapshot(runtimeDir);
      const registryOk = snap.ok || snap.reason === "missing";

      const parts = [
        `daemon running (pid ${typeof st.pid === "number" ? st.pid : "?"})`,
        `sessions=${typeof st.sessions === "number" ? st.sessions : "?"}`,
      ];
      if (paused > 0) {
        return {
          id: "daemon",
          status: "warn",
          summary: `${parts.join(", ")}; ${paused} paused (suspended owner)`,
          fix: "Resume the suspended Claude process with fg, or stop the session. Purr pauses while the owner is stopped.",
        };
      }
      if (!registryOk) {
        return {
          id: "daemon",
          status: "warn",
          summary: `${parts.join(", ")}; registry snapshot corrupt (will regenerate)`,
          fix: `Delete ${join(runtimeDir, "registry.json")} if problems persist.`,
        };
      }
      return {
        id: "daemon",
        status: "ok",
        summary: `${parts.join(", ")}; socket reachable; registry ok`,
      };
    } finally {
      client.close();
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      id: "daemon",
      status: "fail",
      summary: "Daemon not reachable",
      fix: `Start any purrcode command (status/on) to spawn the daemon. Detail: ${msg}`,
    };
  }
}

async function checkSound(deps: DoctorDeps): Promise<DoctorCheck> {
  const cfg = loadConfig({
    platform: deps.platform,
    env: deps.env,
    home: deps.home,
    ...deps.configDir,
  }).config;
  const bundled = resolveBundledSoundPath(cfg.sound);
  const source = existsSync(bundled.preferred)
    ? bundled.preferred
    : existsSync(bundled.wav)
      ? bundled.wav
      : null;
  if (!source) {
    return {
      id: "sound",
      status: "fail",
      summary: `Selected sound "${cfg.sound}" not found under sounds/`,
      fix: "Restore the bundled sleepy asset or set config.sound to an existing file name.",
    };
  }
  try {
    // Best-effort WAV cache probe (may no-op if already cached / twin present).
    await ensureWavCache({
      sourcePath: source,
      soundName: cfg.sound,
      env: deps.env,
      home: deps.home,
      platform: deps.platform,
    });
    return {
      id: "sound",
      status: "ok",
      summary: `Selected purr found (${cfg.sound}); WAV cache ok`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Source exists but cache failed — warn (tier-1 can still play OGG).
    return {
      id: "sound",
      status: "warn",
      summary: `Selected purr found (${cfg.sound}) but WAV cache incomplete`,
      fix: `Build the sidecar (pnpm sidecar:build) so --export can populate the cache. (${msg})`,
    };
  }
}

export function defaultDoctorHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.HOME?.trim() || env.USERPROFILE?.trim() || homedir();
}
