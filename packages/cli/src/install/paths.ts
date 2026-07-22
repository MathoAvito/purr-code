import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PLUGIN_ID = "purrcode@purrcode";
export const MARKETPLACE_NAME = "purrcode";
export const PLUGIN_NAME = "purrcode";

export type ResolveMarketplaceOptions = {
  env?: NodeJS.ProcessEnv;
  /** Override for tests. */
  marketplacePath?: string;
};

/**
 * Locate the local marketplace directory that contains `plugins/purrcode`.
 *
 * Order:
 * 1. `options.marketplacePath`
 * 2. `PURRCODE_MARKETPLACE` env
 * 3. Packaged copy next to this module: `plugin-marketplace/` (npm / assembled)
 * 4. Monorepo: `packages/plugin/marketplace`
 */
export function resolveMarketplacePath(options: ResolveMarketplaceOptions = {}): string {
  if (options.marketplacePath) return options.marketplacePath;
  const env = options.env ?? process.env;
  const override = env.PURRCODE_MARKETPLACE?.trim();
  if (override) return override;

  const here = dirname(fileURLToPath(import.meta.url));
  // dist/install → packages/cli/plugin-marketplace
  const packaged = join(here, "..", "..", "plugin-marketplace");
  if (isMarketplaceDir(packaged)) return packaged;

  // dist/install → packages/cli/dist/install → repo packages/plugin/marketplace
  const monorepo = join(here, "..", "..", "..", "..", "packages", "plugin", "marketplace");
  if (isMarketplaceDir(monorepo)) return monorepo;

  throw new Error(
    "PurrCode marketplace not found. Run `pnpm plugin:build` in a checkout, or reinstall the purr-code package.",
  );
}

export function isMarketplaceDir(path: string): boolean {
  return (
    existsSync(join(path, ".claude-plugin", "marketplace.json")) &&
    existsSync(join(path, "plugins", "purrcode", "hooks", "hooks.json"))
  );
}

/** Expected persistent data dir after install (ADR 0005). */
export function expectedPluginDataDir(home: string): string {
  return join(home, ".claude", "plugins", "data", "purrcode-purrcode");
}

/** Claude caches installed plugin copies here. */
export function findCachedPluginRoot(home: string): string | undefined {
  const cache = join(home, ".claude", "plugins", "cache", "purrcode", "purrcode");
  if (!existsSync(cache)) return undefined;
  try {
    const versions = readdirSync(cache).filter((name) =>
      existsSync(join(cache, name, "dist", "hook.js")),
    );
    if (versions.length === 0) return undefined;
    versions.sort();
    return join(cache, versions[versions.length - 1]!);
  } catch {
    return undefined;
  }
}
