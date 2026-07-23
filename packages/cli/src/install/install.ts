import { homedir } from "node:os";
import { join } from "node:path";

import {
  selectAudioBackend,
  type SelectAudioBackendOptions,
  type SelectedAudioBackend,
} from "../audio/detect.js";
import { preparePluginData } from "../plugin/prepareData.js";
import { style } from "../cli/style.js";
import { startCatSpinner, type CatSpinner } from "../cli/spinner.js";
import { createClaudePluginOps, type ClaudePluginOps } from "./claudePlugin.js";
import {
  PLUGIN_ID,
  MARKETPLACE_NAME,
  expectedPluginDataDir,
  findCachedPluginRoot,
  resolveMarketplaceSource,
  type MarketplaceSource,
} from "./paths.js";
import { syncStableMarketplace } from "./stableMarketplace.js";

export type InstallOptions = {
  env?: NodeJS.ProcessEnv;
  home?: string;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
  /** Inject Claude plugin ops (tests). */
  claude?: ClaudePluginOps;
  /** Inject marketplace path (tests). Registered as-is, like the env override. */
  marketplacePath?: string;
  /** Inject a full marketplace source incl. kind (tests). */
  marketplaceSource?: MarketplaceSource;
  /** Inject backend selection for playback verify (tests). */
  selectBackend?: (opts: SelectAudioBackendOptions) => Promise<SelectedAudioBackend>;
  /** Override sidecar for WAV cache prep. */
  sidecarBin?: string | null;
  /** Inject spinner factory (tests). */
  spinner?: (label: string) => CatSpinner;
  /** Override the printed command prefix (tests). */
  cliHint?: string;
};

/**
 * How the user should invoke follow-up commands. Under `npx purr-code …` no
 * `purrcode` binary lands on PATH (npx runs from its cache), so printing bare
 * `purrcode` commands would fail for exactly those users.
 */
export function detectCliHint(argv1: string | undefined = process.argv[1]): string {
  return argv1 && /[\\/]_npx[\\/]/.test(argv1) ? "npx purr-code" : "purrcode";
}

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
  // Animate only for a real interactive stdout; injected streams stay clean.
  const spin =
    options.spinner ??
    ((label: string) => startCatSpinner(label, options.stdout ? { env, enabled: false } : { env }));

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
    const source =
      options.marketplaceSource ??
      resolveMarketplaceSource({
        env,
        ...(options.marketplacePath !== undefined
          ? { marketplacePath: options.marketplacePath }
          : {}),
      });
    marketplacePath = source.path;
    if (source.kind === "packaged") {
      // node_modules / npx cache is ephemeral; register a stable per-user copy
      // so `claude plugin marketplace update` keeps a live source.
      const spinner = spin("Copying plugin files…");
      try {
        marketplacePath = await syncStableMarketplace({ sourcePath: source.path, env, home });
      } finally {
        spinner.stop();
      }
      out(style.ok("✓ Copied plugin files to a stable location", env));
      out(style.dim(`  ${marketplacePath}`, env));
    }
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
  const prepSpinner = spin("Installing sounds…");
  try {
    await preparePluginData({
      env: {
        ...env,
        CLAUDE_PLUGIN_DATA: pluginData,
        CLAUDE_PLUGIN_ROOT: pluginRoot,
      },
      ...(options.sidecarBin !== undefined ? { sidecarBin: options.sidecarBin } : {}),
    });
    prepSpinner.stop();
    preparedOk = true;
    out(style.ok("✓ Installed default purr (sleepy) + WAV cache", env));
    out(style.dim(`  data: ${pluginData}`, env));
  } catch (e) {
    prepSpinner.stop();
    const msg = e instanceof Error ? e.message : String(e);
    err(style.warn(`⚠ Could not prepare plugin data: ${msg}`, env));
    err(style.dim("  Audio may still work via bundled sounds; try `purrcode doctor`.", env));
  }

  let tier: string | number | undefined;
  let backendName: string | undefined;
  const verifySpinner = spin("Verifying audio playback…");
  try {
    const selected = await selectBackend({
      env: {
        ...env,
        CLAUDE_PLUGIN_DATA: pluginData,
        CLAUDE_PLUGIN_ROOT: pluginRoot,
      },
    });
    verifySpinner.stop();
    tier = selected.capabilities.tier;
    backendName = selected.capabilities.name;
    out(style.ok(`✓ Verified audio playback (tier ${tier}: ${backendName})`, env));
  } catch (e) {
    verifySpinner.stop();
    const msg = e instanceof Error ? e.message : String(e);
    err(style.warn(`⚠ Audio verification incomplete: ${msg}`, env));
    err(style.dim("  Fix: install mpv or build the sidecar; run `purrcode doctor`.", env));
  }

  const hint = options.cliHint ?? detectCliHint();
  out("");
  out(style.bold("⟳ Restart Claude Code (or start a new session) to load the purr hooks.", env));
  out("");
  out("Claude will then purr while working.");
  out("");
  out(style.dim(`Try it:            ${hint} preview`, env));
  out(style.dim(`Adjust volume:     ${hint} volume 30`, env));
  if (!preparedOk) {
    out(style.dim(`Diagnose:          ${hint} doctor`, env));
  }
  if (hint !== "purrcode") {
    out("");
    out(
      style.dim("Tip: `npm install -g purr-code` gives you a permanent `purrcode` command.", env),
    );
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
  return findCachedPluginRoot(home) ?? join(marketplacePath, "plugins", "purrcode");
}
