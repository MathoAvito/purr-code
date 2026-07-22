export {
  createClaudePluginOps,
  type ClaudePluginOps,
  type ClaudeProbeResult,
  type RunClaudeOptions,
} from "./claudePlugin.js";
export { runInstall, type InstallOptions, type InstallResult } from "./install.js";
export {
  runUninstall,
  parseUninstallArgs,
  type UninstallFlags,
  type UninstallOptions,
  type UninstallResult,
} from "./uninstall.js";
export {
  PLUGIN_ID,
  MARKETPLACE_NAME,
  PLUGIN_NAME,
  expectedPluginDataDir,
  findCachedPluginRoot,
  isMarketplaceDir,
  resolveMarketplacePath,
  resolveMarketplaceSource,
  type MarketplaceSource,
  type ResolveMarketplaceOptions,
} from "./paths.js";
export {
  removeStableMarketplace,
  stableMarketplaceDir,
  syncStableMarketplace,
  type SyncStableMarketplaceOptions,
} from "./stableMarketplace.js";
