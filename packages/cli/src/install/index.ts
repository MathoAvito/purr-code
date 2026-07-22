export {
  createClaudePluginOps,
  type ClaudePluginOps,
  type ClaudeProbeResult,
  type RunClaudeOptions,
} from "./claudePlugin.js";
export { runInstall, type InstallOptions, type InstallResult } from "./install.js";
export {
  PLUGIN_ID,
  MARKETPLACE_NAME,
  PLUGIN_NAME,
  expectedPluginDataDir,
  findCachedPluginRoot,
  isMarketplaceDir,
  resolveMarketplacePath,
  type ResolveMarketplaceOptions,
} from "./paths.js";
