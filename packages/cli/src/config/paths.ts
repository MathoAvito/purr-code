import { homedir } from "node:os";
import { join } from "node:path";

import { pluginDataFromEnv } from "../plugin/env.js";

export type ResolveConfigDirOptions = {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  /** Override home directory (tests). */
  home?: string;
};

/**
 * Per-user config directory (PC-204 / FR-06) — not the runtime/socket dir.
 *
 * When `CLAUDE_PLUGIN_DATA` is set (plugin context), config lives there so it
 * survives plugin updates (FR-01 / PC-401).
 *
 * | Platform | Location |
 * |---|---|
 * | Plugin | `${CLAUDE_PLUGIN_DATA}` |
 * | Linux | `$XDG_CONFIG_HOME/purrcode` or `~/.config/purrcode` |
 * | macOS | `~/Library/Application Support/PurrCode` |
 * | Windows | `%LOCALAPPDATA%\PurrCode` |
 */
export function resolveConfigDirPath(options: ResolveConfigDirOptions = {}): string {
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

  const xdg = env.XDG_CONFIG_HOME?.trim();
  if (xdg) return join(xdg, "purrcode");
  return join(home, ".config", "purrcode");
}

export function resolveConfigFilePath(options: ResolveConfigDirOptions = {}): string {
  return join(resolveConfigDirPath(options), "config.json");
}
