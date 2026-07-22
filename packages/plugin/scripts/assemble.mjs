#!/usr/bin/env node
/**
 * Assemble the Claude Code plugin tree (PC-401):
 * - copy packages/cli/dist → marketplace/plugins/purrcode/dist
 * - copy repo sounds/sleepy.{ogg,wav} → plugin sounds/
 * - copy host-platform sidecar binary → plugin vendor/sidecar/
 * - sync plugin.json version from packages/cli/package.json
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pluginPkg = join(here, "..");
const repoRoot = join(pluginPkg, "..", "..");
const pluginRoot = join(pluginPkg, "marketplace", "plugins", "purrcode");
const cliDist = join(repoRoot, "packages", "cli", "dist");
const soundsSrc = join(repoRoot, "sounds");

function fail(msg) {
  console.error(`assemble: ${msg}`);
  process.exit(1);
}

if (!existsSync(join(cliDist, "hook.js"))) {
  fail(`cli dist missing (${cliDist}/hook.js). Run: pnpm --filter purr-code build`);
}
if (!existsSync(join(soundsSrc, "sleepy.ogg")) || !existsSync(join(soundsSrc, "sleepy.wav"))) {
  fail("sounds/sleepy.{ogg,wav} missing at repo root");
}

const cliPkg = JSON.parse(readFileSync(join(repoRoot, "packages", "cli", "package.json"), "utf8"));
const pluginJsonPath = join(pluginRoot, ".claude-plugin", "plugin.json");
const pluginJson = JSON.parse(readFileSync(pluginJsonPath, "utf8"));
pluginJson.version = cliPkg.version;
writeFileSync(pluginJsonPath, `${JSON.stringify(pluginJson, null, 2)}\n`);

const distOut = join(pluginRoot, "dist");
rmSync(distOut, { recursive: true, force: true });
cpSync(cliDist, distOut, { recursive: true });

const soundsOut = join(pluginRoot, "sounds");
mkdirSync(soundsOut, { recursive: true });
cpSync(join(soundsSrc, "sleepy.ogg"), join(soundsOut, "sleepy.ogg"));
cpSync(join(soundsSrc, "sleepy.wav"), join(soundsOut, "sleepy.wav"));
// license metadata is committed under sounds/; keep it if present

// Host-platform sidecar → vendor/sidecar/ (optional; tiers 2/3 still work without it)
const platform = process.platform;
const arch = process.arch;
const os =
  platform === "linux"
    ? "linux"
    : platform === "darwin"
      ? "darwin"
      : platform === "win32"
        ? "win32"
        : null;
const cpu = arch === "x64" || arch === "arm64" ? arch : null;
if (os && cpu && !(os === "linux" && cpu !== "x64") && !(os === "win32" && cpu !== "x64")) {
  const binName = platform === "win32" ? "purr-sidecar.exe" : "purr-sidecar";
  const sidecarBin = join(repoRoot, "packages", `sidecar-${os}-${cpu}`, "bin", binName);
  if (existsSync(sidecarBin)) {
    const vendorDir = join(pluginRoot, "vendor", "sidecar");
    mkdirSync(vendorDir, { recursive: true });
    cpSync(sidecarBin, join(vendorDir, binName));
  }
}

console.log(`assemble: plugin ready at ${pluginRoot}`);
console.log(`assemble: version ${pluginJson.version}`);
console.log(`assemble: dist/hook.js + sounds/sleepy + license metadata`);
