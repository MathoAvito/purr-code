#!/usr/bin/env node
/**
 * Validate assembled plugin layout (PC-401).
 * Uses the same hooks-manifest rules as packages/cli (inlined to keep this script dep-free).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const pluginRoot = join(here, "..", "marketplace", "plugins", "purrcode");
const marketplaceRoot = join(here, "..", "marketplace");

function fail(msg) {
  console.error(`validate: ${msg}`);
  process.exit(1);
}

const requiredFiles = [
  ".claude-plugin/plugin.json",
  "hooks/hooks.json",
  "dist/hook.js",
  "dist/cli.js",
  "dist/daemon/entry.js",
  "sounds/sleepy.ogg",
  "sounds/sleepy.wav",
  "sounds/sleepy.license.json",
];

for (const rel of requiredFiles) {
  if (!existsSync(join(pluginRoot, rel))) fail(`missing ${rel}`);
}

const hooks = JSON.parse(readFileSync(join(pluginRoot, "hooks", "hooks.json"), "utf8"));
const events = ["UserPromptSubmit", "Stop", "StopFailure", "SessionEnd"];
const argMap = {
  UserPromptSubmit: "start",
  Stop: "stop",
  StopFailure: "failure",
  SessionEnd: "session-end",
};

for (const event of events) {
  const entry = hooks.hooks?.[event]?.[0];
  if (!entry) fail(`hooks.json missing ${event}`);
  if ("matcher" in entry) fail(`${event}: matcher forbidden`);
  const cmd = entry.hooks?.[0];
  if (!cmd || cmd.type !== "command" || cmd.command !== "node") {
    fail(`${event}: must be exec-form command: node`);
  }
  if (cmd.args?.[0] !== "${CLAUDE_PLUGIN_ROOT}/dist/hook.js") {
    fail(`${event}: args[0] must be \${CLAUDE_PLUGIN_ROOT}/dist/hook.js`);
  }
  if (cmd.args?.[1] !== argMap[event]) fail(`${event}: args[1] must be ${argMap[event]}`);
  if (cmd.async !== true) fail(`${event}: async must be true`);
  if (cmd.timeout !== 5) fail(`${event}: timeout must be 5`);
}

const pluginJson = JSON.parse(
  readFileSync(join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8"),
);
if (pluginJson.name !== "purrcode") fail("plugin.json name must be purrcode");

const marketplace = JSON.parse(
  readFileSync(join(marketplaceRoot, ".claude-plugin", "marketplace.json"), "utf8"),
);
if (marketplace.name !== "purrcode") fail("marketplace.json name must be purrcode");

// Prefer Claude's own validator when available.
const claude = spawnSync("claude", ["plugin", "validate", pluginRoot], {
  encoding: "utf8",
  shell: false,
});
if (claude.error && claude.error.code === "ENOENT") {
  console.log("validate: claude CLI not on PATH — skipped `claude plugin validate`");
} else if (claude.status !== 0) {
  console.error(claude.stdout || "");
  console.error(claude.stderr || "");
  fail(`claude plugin validate failed (exit ${claude.status})`);
} else {
  console.log("validate: claude plugin validate OK");
}

console.log("validate: plugin layout OK (PC-401)");
