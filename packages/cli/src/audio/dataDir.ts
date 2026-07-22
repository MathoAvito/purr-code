import { homedir } from "node:os";
import { join } from "node:path";

import { pluginDataFromEnv } from "../plugin/env.js";

export type ResolveDataDirOptions = {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  home?: string;
};

/**
 * Per-user data directory for sounds + WAV cache (FR-08 / PC-304).
 *
 * When `CLAUDE_PLUGIN_DATA` is set (plugin context), data lives there so the
 * WAV cache and bundled copies survive plugin updates (FR-01 / PC-401).
 *
 * | Platform | Location |
 * |---|---|
 * | Plugin | `${CLAUDE_PLUGIN_DATA}` |
 * | Linux | `$XDG_DATA_HOME/purrcode` or `~/.local/share/purrcode` |
 * | macOS | `~/Library/Application Support/PurrCode` |
 * | Windows | `%LOCALAPPDATA%\PurrCode` |
 */
export function resolveDataDirPath(options: ResolveDataDirOptions = {}): string {
  const env = options.env ?? process.env;
  const pluginData = pluginDataFromEnv(env);
  if (pluginData) return pluginData;

  const platform = options.platform ?? process.platform;
  const home = options.home ?? homedir();

  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA?.trim() || join(home, "AppData", "Local");
    return join(localAppData, "PurrCode");
  }

  if (platform === "darwin") {
    return join(home, "Library", "Application Support", "PurrCode");
  }

  const xdg = env.XDG_DATA_HOME?.trim();
  if (xdg) return join(xdg, "purrcode");
  return join(home, ".local", "share", "purrcode");
}

export function resolveSoundsDirPath(options: ResolveDataDirOptions = {}): string {
  return join(resolveDataDirPath(options), "sounds");
}
