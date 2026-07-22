import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  selectAudioBackend,
  type SelectAudioBackendOptions,
  type SelectedAudioBackend,
} from "../audio/detect.js";
import { preparePluginData } from "../plugin/prepareData.js";
import { style } from "../cli/style.js";
import { createClaudePluginOps, type ClaudePluginOps } from "./claudePlugin.js";
import {
  PLUGIN_ID,
  MARKETPLACE_NAME,
  expectedPluginDataDir,
  findCachedPluginRoot,
  resolveMarketplacePath,
} from "./paths.js";

export type InstallOptions = {
  env?: NodeJS.ProcessEnv;
  home?: string;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
  /** Inject Claude plugin ops (tests). */
  claude?: ClaudePluginOps;
  /** Inject marketplace path (tests). */
  marketplacePath?: string;
  /** Inject backend selection for playback verify (tests). */
  selectBackend?: (opts: SelectAudioBackendOptions) => Promise<SelectedAudioBackend>;
  /** Override sidecar for WAV cache prep. */
  sidecarBin?: string | null;
};

export type InstallResult = {
  exitCode: number;
  alreadyInstalled: boolean;
  pluginId: string;
  marketplacePath?: string;
  pluginData?: string;
  pluginRoot?: string;
  tier?: string | number;
  backendName?: string;
};

/**
 * `purrcode install` — plugin-first installer (PC-402 / §14).
 * Never touches settings.json. Hooks remain exec-form via the plugin package.
 */
export async function runInstall(options: InstallOptions = {}): Promise<InstallResult> {
  const env = options.env ?? process.env;
  const home = options.home ?? (env.HOME?.trim() || homedir());
  const out = options.stdout ?? ((line: string) => process.stdout.write(`${line}\n`));
  const err = options.stderr ?? ((line: string) => process.stderr.write(`${line}\n`));
  const claude = options.claude ?? createClaudePluginOps({ env });
  const selectBackend = options.selectBackend ?? selectAudioBackend;

  out(style.bold("🐈 Installing PurrCode", env));
  out("");

  const probe = await claude.probeClaude();
  if (!probe.present) {
    err(style.err(`✗ Claude Code not detected: ${probe.detail}`, env));
    err(style.dim("Fix: install Claude Code and ensure `claude` is on your PATH.", env));
    return { exitCode: 1, alreadyInstalled: false, pluginId: PLUGIN_ID };
  }
  out(style.ok(`✓ Detected Claude Code (${probe.version})`, env));

  let marketplacePath: string;
  try {
    marketplacePath = resolveMarketplacePath({
      env,
      ...(options.marketplacePath !== undefined
        ? { marketplacePath: options.marketplacePath }
        : {}),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    err(style.err(`✗ ${msg}`, env));
    return { exitCode: 1, alreadyInstalled: false, pluginId: PLUGIN_ID };
  }

  let installedIds: string[];
  try {
    installedIds = await claude.pluginList();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    err(style.err(`✗ Could not list installed plugins: ${msg}`, env));
    err(style.dim("Fix: run `claude plugin list` and check Claude Code is working.", env));
    return { exitCode: 1, alreadyInstalled: false, pluginId: PLUGIN_ID, marketplacePath };
  }

  const already = installedIds.some(
    (id) => id === PLUGIN_ID || id.startsWith("purrcode@") || id === "purrcode",
  );
  if (already) {
    out(style.ok(`✓ PurrCode plugin already installed (${PLUGIN_ID})`, env));
    out(style.dim("  Re-run is idempotent — nothing duplicated.", env));
  } else {
    try {
      const markets = await claude.marketplaceList();
      if (!markets.includes(MARKETPLACE_NAME)) {
        await claude.marketplaceAdd(marketplacePath);
        out(style.ok(`✓ Registered marketplace (${MARKETPLACE_NAME})`, env));
        out(style.dim(`  source: ${marketplacePath}`, env));
      } else {
        out(style.ok(`✓ Marketplace already registered (${MARKETPLACE_NAME})`, env));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      err(style.err(`✗ Failed to register marketplace: ${msg}`, env));
      err(
        style.dim(`Fix: run \`claude plugin marketplace add ${marketplacePath}\` then retry.`, env),
      );
      return { exitCode: 1, alreadyInstalled: false, pluginId: PLUGIN_ID, marketplacePath };
    }

    try {
      await claude.pluginInstall(PLUGIN_ID);
      out(style.ok(`✓ Installed PurrCode plugin (${PLUGIN_ID})`, env));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      err(style.err(`✗ Plugin install failed: ${msg}`, env));
      err(
        style.dim(
          `Fix: run \`claude plugin install ${PLUGIN_ID}\` and check \`claude plugin validate\`.`,
          env,
        ),
      );
      return { exitCode: 1, alreadyInstalled: false, pluginId: PLUGIN_ID, marketplacePath };
    }
  }

  const pluginData = expectedPluginDataDir(home);
  const pluginRoot = resolvePluginRoot(home, marketplacePath);

  let preparedOk = false;
  try {
    await preparePluginData({
      env: {
        ...env,
        CLAUDE_PLUGIN_DATA: pluginData,
        CLAUDE_PLUGIN_ROOT: pluginRoot,
      },
      ...(options.sidecarBin !== undefined ? { sidecarBin: options.sidecarBin } : {}),
    });
    preparedOk = true;
    out(style.ok("✓ Installed default purr (sleepy) + WAV cache", env));
    out(style.dim(`  data: ${pluginData}`, env));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    err(style.warn(`⚠ Could not prepare plugin data: ${msg}`, env));
    err(style.dim("  Audio may still work via bundled sounds; try `purrcode doctor`.", env));
  }

  let tier: string | number | undefined;
  let backendName: string | undefined;
  try {
    const selected = await selectBackend({
      env: {
        ...env,
        CLAUDE_PLUGIN_DATA: pluginData,
        CLAUDE_PLUGIN_ROOT: pluginRoot,
      },
    });
    tier = selected.capabilities.tier;
    backendName = selected.capabilities.name;
    out(style.ok(`✓ Verified audio playback (tier ${tier}: ${backendName})`, env));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    err(style.warn(`⚠ Audio verification incomplete: ${msg}`, env));
    err(style.dim("  Fix: install mpv or build the sidecar; run `purrcode doctor`.", env));
  }

  out("");
  out("Claude will now purr while working.");
  out("");
  out(style.dim("Try it:            purrcode preview", env));
  out(style.dim("Adjust volume:     purrcode volume 15", env));
  if (!preparedOk) {
    out(style.dim("Diagnose:          purrcode doctor", env));
  }

  return {
    exitCode: 0,
    alreadyInstalled: already,
    pluginId: PLUGIN_ID,
    marketplacePath,
    pluginData,
    pluginRoot,
    ...(tier !== undefined ? { tier } : {}),
    ...(backendName !== undefined ? { backendName } : {}),
  };
}

function resolvePluginRoot(home: string, marketplacePath: string): string {
  const cached = findCachedPluginRoot(home);
  if (cached) return cached;
  const sourcePlugin = join(marketplacePath, "plugins", "purrcode");
  if (
    existsSync(join(sourcePlugin, "dist", "hook.js")) ||
    existsSync(join(sourcePlugin, "sounds"))
  ) {
    return sourcePlugin;
  }
  return sourcePlugin;
}
