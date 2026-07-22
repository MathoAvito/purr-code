/**
 * Validate plugin `hooks/hooks.json` against PRD §15 / PC-401 constraints.
 */

export type HooksManifestIssue = { path: string; message: string };

const REQUIRED_EVENTS = ["UserPromptSubmit", "Stop", "StopFailure", "SessionEnd"] as const;

const EVENT_ARG: Record<(typeof REQUIRED_EVENTS)[number], string> = {
  UserPromptSubmit: "start",
  Stop: "stop",
  StopFailure: "failure",
  SessionEnd: "session-end",
};

export type ValidateHooksManifestOptions = {
  /** Expected hook script path pattern (default: ${CLAUDE_PLUGIN_ROOT}/dist/hook.js). */
  hookScriptArg?: string;
};

/**
 * Structural validation for the production plugin hooks.json.
 * Returns an empty array when the manifest matches §15.
 */
export function validateHooksManifest(
  raw: unknown,
  options: ValidateHooksManifestOptions = {},
): HooksManifestIssue[] {
  const issues: HooksManifestIssue[] = [];
  const hookScript = options.hookScriptArg ?? "${CLAUDE_PLUGIN_ROOT}/dist/hook.js";

  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return [{ path: "", message: "hooks.json must be a JSON object" }];
  }

  const root = raw as Record<string, unknown>;
  if (typeof root.description !== "string" || !root.description.trim()) {
    issues.push({ path: "description", message: "description must be a non-empty string" });
  }

  const hooks = root.hooks;
  if (hooks === null || typeof hooks !== "object" || Array.isArray(hooks)) {
    issues.push({ path: "hooks", message: "hooks must be an object" });
    return issues;
  }

  const hooksObj = hooks as Record<string, unknown>;
  for (const event of REQUIRED_EVENTS) {
    const entries = hooksObj[event];
    if (!Array.isArray(entries) || entries.length < 1) {
      issues.push({ path: `hooks.${event}`, message: "must be a non-empty array" });
      continue;
    }

    const first: unknown = entries[0];
    if (first === null || typeof first !== "object" || Array.isArray(first)) {
      issues.push({ path: `hooks.${event}[0]`, message: "must be an object" });
      continue;
    }

    const entry = first as Record<string, unknown>;
    if ("matcher" in entry) {
      issues.push({
        path: `hooks.${event}[0].matcher`,
        message: "matcher fields are forbidden (PRD §15)",
      });
    }

    const inner = entry.hooks;
    if (!Array.isArray(inner) || inner.length < 1) {
      issues.push({ path: `hooks.${event}[0].hooks`, message: "must be a non-empty array" });
      continue;
    }

    const cmd: unknown = inner[0];
    if (cmd === null || typeof cmd !== "object" || Array.isArray(cmd)) {
      issues.push({ path: `hooks.${event}[0].hooks[0]`, message: "must be an object" });
      continue;
    }

    const c = cmd as Record<string, unknown>;
    if (c.type !== "command") {
      issues.push({ path: `hooks.${event}[0].hooks[0].type`, message: 'must be "command"' });
    }
    if (c.command !== "node") {
      issues.push({
        path: `hooks.${event}[0].hooks[0].command`,
        message: 'must be "node" (exec form; never string-form / npx)',
      });
    }
    if (typeof c.command === "string" && c.command.includes(" ")) {
      issues.push({
        path: `hooks.${event}[0].hooks[0].command`,
        message: "string-form shell commands are forbidden",
      });
    }
    if (!Array.isArray(c.args) || c.args.length < 2) {
      issues.push({
        path: `hooks.${event}[0].hooks[0].args`,
        message: "must be [hookScript, eventArg]",
      });
    } else {
      if (c.args[0] !== hookScript) {
        issues.push({
          path: `hooks.${event}[0].hooks[0].args[0]`,
          message: `must be ${JSON.stringify(hookScript)}`,
        });
      }
      if (c.args[1] !== EVENT_ARG[event]) {
        issues.push({
          path: `hooks.${event}[0].hooks[0].args[1]`,
          message: `must be ${JSON.stringify(EVENT_ARG[event])}`,
        });
      }
      for (let i = 0; i < c.args.length; i++) {
        if (typeof c.args[i] !== "string") {
          issues.push({
            path: `hooks.${event}[0].hooks[0].args[${i}]`,
            message: "args must be strings",
          });
        }
      }
    }
    if (c.async !== true) {
      issues.push({ path: `hooks.${event}[0].hooks[0].async`, message: "must be true" });
    }
    if (c.timeout !== 5) {
      issues.push({ path: `hooks.${event}[0].hooks[0].timeout`, message: "must be 5" });
    }
  }

  return issues;
}
