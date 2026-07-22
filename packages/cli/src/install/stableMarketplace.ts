import { existsSync } from "node:fs";
import { cp, mkdir, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { resolveDataDirPath, type ResolveDataDirOptions } from "../audio/dataDir.js";

/**
 * Stable per-user home for the registered marketplace copy.
 *
 * The npm package's `plugin-marketplace/` lives in node_modules (or the npx
 * cache), which is evicted/removed independently of the Claude registration.
 * `purrcode install` copies it here and registers this path instead, so
 * `claude plugin marketplace update` keeps a live source.
 */
export function stableMarketplaceDir(options: ResolveDataDirOptions = {}): string {
  return join(resolveDataDirPath(options), "marketplace");
}

export type SyncStableMarketplaceOptions = ResolveDataDirOptions & {
  /** Marketplace tree to copy (the packaged `plugin-marketplace/`). */
  sourcePath: string;
};

/**
 * Copy the marketplace tree to the stable dir (replacing any previous copy)
 * and return the stable path. Copies to a temp sibling then renames, so a
 * concurrently-running Claude never sees a half-written tree.
 */
export async function syncStableMarketplace(
  options: SyncStableMarketplaceOptions,
): Promise<string> {
  const dest = stableMarketplaceDir(options);
  if (resolve(options.sourcePath) === resolve(dest)) return dest;

  const tmp = `${dest}.tmp-${process.pid}`;
  await mkdir(dirname(dest), { recursive: true });
  await rm(tmp, { recursive: true, force: true });
  try {
    await cp(options.sourcePath, tmp, { recursive: true });
    await rm(dest, { recursive: true, force: true });
    await rename(tmp, dest);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
  return dest;
}

/** Remove the stable marketplace copy (uninstall). Returns the path when one existed. */
export async function removeStableMarketplace(
  options: ResolveDataDirOptions = {},
): Promise<string | null> {
  const dest = stableMarketplaceDir(options);
  if (!existsSync(dest)) return null;
  await rm(dest, { recursive: true, force: true });
  return dest;
}
