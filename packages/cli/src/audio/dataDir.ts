import { homedir } from "node:os";
import { join } from "node:path";

export type ResolveDataDirOptions = {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  home?: string;
};

/**
 * Per-user data directory for sounds + WAV cache (FR-08 / PC-304).
 *
 * | Platform | Location |
 * |---|---|
 * | Linux | `$XDG_DATA_HOME/purrcode` or `~/.local/share/purrcode` |
 * | macOS | `~/Library/Application Support/PurrCode` |
 * | Windows | `%LOCALAPPDATA%\PurrCode` |
 */
export function resolveDataDirPath(options: ResolveDataDirOptions = {}): string {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
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
