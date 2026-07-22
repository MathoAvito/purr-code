/**
 * Claude Code plugin environment (PC-401 / FR-01).
 *
 * When hooks run from a plugin, Claude sets:
 * - `CLAUDE_PLUGIN_ROOT` — installed plugin directory
 * - `CLAUDE_PLUGIN_DATA` — persistent data dir (survives plugin updates)
 */

export function pluginRootFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const v = env.CLAUDE_PLUGIN_ROOT?.trim();
  return v || undefined;
}

export function pluginDataFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const v = env.CLAUDE_PLUGIN_DATA?.trim();
  return v || undefined;
}

/** True when running inside a Claude Code plugin hook/process. */
export function isPluginContext(env: NodeJS.ProcessEnv = process.env): boolean {
  return pluginRootFromEnv(env) !== undefined || pluginDataFromEnv(env) !== undefined;
}
