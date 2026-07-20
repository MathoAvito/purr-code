import { chmod, lstat, mkdir } from "node:fs/promises";
import type { Stats } from "node:fs";

import { RuntimeDirError } from "./errors.js";
import { resolveRuntimeDirPath, type ResolveRuntimeDirOptions } from "./resolveRuntimeDir.js";

export type RuntimeDirFs = {
  mkdir: typeof mkdir;
  lstat: typeof lstat;
  chmod: typeof chmod;
};

export type EnsureRuntimeDirOptions = ResolveRuntimeDirOptions & {
  /** Override filesystem ops (tests). Defaults to `node:fs/promises`. */
  fs?: RuntimeDirFs;
};

const DIR_MODE = 0o700;

/**
 * Create (if needed) and harden-verify the per-user runtime directory.
 *
 * Hardening (FR-05 / §13):
 * 1. `mkdir` with mode `0700` (recursive)
 * 2. `lstat` — must be a directory, not a symlink
 * 3. On Unix: owned by the current user; mode forced to `0700` (no group/other bits)
 *
 * Returns the absolute path on success. Throws {@link RuntimeDirError} otherwise.
 */
export async function ensureRuntimeDir(options: EnsureRuntimeDirOptions = {}): Promise<string> {
  const platform = options.platform ?? process.platform;
  const dirFs = options.fs ?? { mkdir, lstat, chmod };
  const uid = "uid" in options ? options.uid : process.getuid?.();
  const path = resolveRuntimeDirPath(options);

  try {
    await dirFs.mkdir(path, { recursive: true, mode: DIR_MODE });
  } catch (err) {
    // Node throws EEXIST when a non-directory occupies the path; fall through
    // to lstat so we report not-directory / symlink consistently.
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code !== "EEXIST") {
      throw err;
    }
  }

  const before = await dirFs.lstat(path);
  assertIdentity(before, { path, platform, uid });

  if (platform !== "win32") {
    // umask may have widened mkdir bits; force 0700 before trusting the path.
    await dirFs.chmod(path, DIR_MODE);
    const after = await dirFs.lstat(path);
    assertIdentity(after, { path, platform, uid });
    if ((after.mode & 0o077) !== 0) {
      throw new RuntimeDirError(
        "insecure-mode",
        `runtime dir has group/other permissions after chmod (mode=${(after.mode & 0o777).toString(8)}): ${path}`,
      );
    }
  }

  return path;
}

function assertIdentity(
  st: Stats,
  ctx: { path: string; platform: NodeJS.Platform; uid: number | undefined },
): void {
  if (st.isSymbolicLink()) {
    throw new RuntimeDirError("symlink", `runtime dir is a symlink (refusing): ${ctx.path}`);
  }
  if (!st.isDirectory()) {
    throw new RuntimeDirError(
      "not-directory",
      `runtime dir path exists but is not a directory: ${ctx.path}`,
    );
  }

  if (ctx.platform === "win32") {
    // Windows has no portable UID/mode checks matching the Unix threat model;
    // LOCALAPPDATA is already per-user. Symlink + directory checks still apply.
    return;
  }

  if (ctx.uid === undefined) {
    throw new RuntimeDirError(
      "wrong-owner",
      `cannot verify runtime dir ownership (UID unavailable): ${ctx.path}`,
    );
  }
  if (st.uid !== ctx.uid) {
    throw new RuntimeDirError(
      "wrong-owner",
      `runtime dir not owned by current user (uid=${st.uid}, expected ${ctx.uid}): ${ctx.path}`,
    );
  }
}
