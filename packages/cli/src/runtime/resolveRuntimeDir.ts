import { homedir } from "node:os";
import { join } from "node:path";

import { RuntimeDirError } from "./errors.js";

export type ResolveRuntimeDirOptions = {
  /** Defaults to `process.platform`. */
  platform?: NodeJS.Platform;
  /** Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /**
   * Defaults to `process.getuid?.()`. Used for the Linux `/tmp` fallback.
   * Pass `undefined` explicitly to simulate a host without UIDs.
   */
  uid?: number | undefined;
};

/**
 * Resolve the per-user runtime directory path per FR-05 (no I/O).
 *
 * | Platform | Location |
 * |---|---|
 * | Linux | `$XDG_RUNTIME_DIR/purrcode/` preferred; `/tmp/purrcode-$UID/` fallback |
 * | macOS | `$TMPDIR/purrcode/` |
 * | Windows | `%LOCALAPPDATA%\PurrCode\runtime\` |
 */
export function resolveRuntimeDirPath(options: ResolveRuntimeDirOptions = {}): string {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;

  // Test / operator override (daemon entry + spawn already honor this).
  const override = env.PURRCODE_RUNTIME_DIR?.trim();
  if (override) return override;

  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA?.trim() || join(homedir(), "AppData", "Local");
    return join(localAppData, "PurrCode", "runtime");
  }

  if (platform === "darwin") {
    const tmp = env.TMPDIR?.trim() || env.TMP?.trim() || "/tmp";
    return join(tmp, "purrcode");
  }

  // Linux and other Unix-likes follow the Linux FR-05 row.
  const xdg = env.XDG_RUNTIME_DIR?.trim();
  if (xdg) {
    return join(xdg, "purrcode");
  }

  const uid = "uid" in options ? options.uid : process.getuid?.();
  if (uid === undefined) {
    throw new RuntimeDirError(
      "unresolved",
      "cannot resolve Linux runtime dir fallback: UID unavailable and XDG_RUNTIME_DIR unset",
    );
  }
  return join("/tmp", `purrcode-${uid}`);
}
