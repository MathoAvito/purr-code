export { CONFIG_SCHEMA_VERSION, DEFAULT_CONFIG, type PurrCodeConfig } from "./defaults.js";
export {
  resolveConfigDirPath,
  resolveConfigFilePath,
  type ResolveConfigDirOptions,
} from "./paths.js";
export { mergeConfig, normalizeConfig } from "./validate.js";
export { applyConfigPatch, loadConfig, writeConfig, type LoadConfigResult } from "./store.js";
