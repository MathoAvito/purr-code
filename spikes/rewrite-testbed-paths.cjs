#!/usr/bin/env node
/**
 * Rewrite absolute Linux paths in spike testbed settings to this clone's root.
 * Required before running PC-001 / PC-006 harnesses on another machine.
 *
 * Usage (from repo root or anywhere):
 *   node spikes/rewrite-testbed-paths.cjs
 */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
const OLD_ROOT = "/home/matho/Documents/github/purr-code";

const TARGETS = [
  "spikes/pc-001-hook-payload/testbed/.claude/settings.json",
  "spikes/pc-001-hook-payload/testbed-execform/.claude/settings.json",
  "spikes/pc-001-hook-payload/testbed-sync/.claude/settings.json",
  "spikes/pc-006-multi-session/testbed/.claude/settings.json",
];

let changed = 0;
for (const rel of TARGETS) {
  const abs = path.join(REPO_ROOT, rel);
  const before = fs.readFileSync(abs, "utf8");
  if (!before.includes(OLD_ROOT)) {
    console.log(`ok (already local or unknown): ${rel}`);
    continue;
  }
  const after = before.split(OLD_ROOT).join(REPO_ROOT);
  fs.writeFileSync(abs, after);
  changed += 1;
  console.log(`rewrote: ${rel}`);
}

console.log(`done — ${changed} file(s) updated; repo root = ${REPO_ROOT}`);
