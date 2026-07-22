import { access, copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

import { ensureWavCache, resolveBundledSoundPath } from "../audio/wavCache.js";
import { resolveSoundsDirPath } from "../audio/dataDir.js";
import { DEFAULT_CONFIG, loadConfig } from "../config/index.js";
import { pluginDataFromEnv, pluginRootFromEnv } from "./env.js";

export type PreparePluginDataOptions = {
  env?: NodeJS.ProcessEnv;
  /** Override bundled sound name (default: config / sleepy). */
  soundName?: string;
  /** When true, write default config.json if missing. */
  writeDefaultsIfMissing?: boolean;
  /** Override sidecar binary for WAV export; `null` disables sidecar. */
  sidecarBin?: string | null;
};

export type PreparePluginDataResult = {
  pluginData: string;
  pluginRoot: string | undefined;
  soundsDir: string;
  configPath: string;
  wavCache: { wavPath: string; created: boolean; method: string };
  soundName: string;
};

/**
 * Prepare persistent plugin data under `${CLAUDE_PLUGIN_DATA}`:
 * config (defaults if missing), sounds dir, and sleepy WAV cache (PC-401).
 *
 * Idempotent. Requires `CLAUDE_PLUGIN_DATA` (or throws).
 */
export async function preparePluginData(
  options: PreparePluginDataOptions = {},
): Promise<PreparePluginDataResult> {
  const env = options.env ?? process.env;
  const pluginData = pluginDataFromEnv(env);
  if (!pluginData) {
    throw new Error("preparePluginData: CLAUDE_PLUGIN_DATA is not set");
  }

  await mkdir(pluginData, { recursive: true });
  const soundsDir = resolveSoundsDirPath({ env });
  await mkdir(soundsDir, { recursive: true });

  const loaded = loadConfig({
    env,
    writeDefaultsIfMissing: options.writeDefaultsIfMissing ?? true,
  });
  const soundName = options.soundName ?? loaded.config.sound ?? DEFAULT_CONFIG.sound;

  const pluginRoot = pluginRootFromEnv(env);
  const bundled = resolveBundledSoundPath(soundName, {
    env,
    ...(pluginRoot !== undefined ? { pluginRoot } : {}),
  });

  let sourcePath = bundled.preferred;
  try {
    await access(sourcePath);
  } catch {
    sourcePath = bundled.wav;
    await access(sourcePath);
  }

  const wavCache = await ensureWavCache({
    sourcePath,
    soundName,
    env,
    ...(options.sidecarBin !== undefined ? { sidecarBin: options.sidecarBin } : {}),
  });

  // Copy license metadata next to the cache when present in the plugin tree.
  const licenseSrc = join(bundled.root, "sounds", `${soundName}.license.json`);
  const licenseDst = join(soundsDir, `${soundName}.license.json`);
  try {
    await access(licenseSrc);
    await copyFile(licenseSrc, licenseDst);
  } catch {
    // optional
  }

  return {
    pluginData,
    pluginRoot,
    soundsDir,
    configPath: loaded.path,
    wavCache,
    soundName,
  };
}
