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
// Source maps stay out of the shipped plugin tree (tarball + per-user copies).
cpSync(cliDist, distOut, { recursive: true, filter: (src) => !src.endsWith(".map") });

const soundsOut = join(pluginRoot, "sounds");
mkdirSync(soundsOut, { recursive: true });
cpSync(join(soundsSrc, "sleepy.ogg"), join(soundsOut, "sleepy.ogg"));
cpSync(join(soundsSrc, "sleepy.wav"), join(soundsOut, "sleepy.wav"));
// license metadata is committed under sounds/; keep it if present

// Sidecar binaries → vendor/sidecar/<os>-<cpu>/ for every built target, so the
// assembled plugin works on all platforms regardless of the machine that packs
// it (optional; tiers 2/3 still work without any).
const SIDECAR_TARGETS = ["linux-x64", "darwin-arm64", "darwin-x64", "win32-x64"];
const vendorRoot = join(pluginRoot, "vendor", "sidecar");
rmSync(vendorRoot, { recursive: true, force: true });
const bundledTargets = [];
for (const target of SIDECAR_TARGETS) {
  const binName = target.startsWith("win32") ? "purr-sidecar.exe" : "purr-sidecar";
  const sidecarBin = join(repoRoot, "packages", `sidecar-${target}`, "bin", binName);
  if (!existsSync(sidecarBin)) continue;
  const targetDir = join(vendorRoot, target);
  mkdirSync(targetDir, { recursive: true });
  cpSync(sidecarBin, join(targetDir, binName));
  bundledTargets.push(target);
}

// Ship a copy inside the npm `purr-code` package for `purrcode install` (PC-402).
const cliMarketplace = join(repoRoot, "packages", "cli", "plugin-marketplace");
rmSync(cliMarketplace, { recursive: true, force: true });
cpSync(join(pluginPkg, "marketplace"), cliMarketplace, { recursive: true });

console.log(`assemble: plugin ready at ${pluginRoot}`);
console.log(`assemble: version ${pluginJson.version}`);
console.log(`assemble: dist/hook.js + sounds/sleepy + license metadata`);
console.log(`assemble: sidecar targets bundled: ${bundledTargets.join(", ") || "none"}`);
console.log(`assemble: mirrored marketplace → ${cliMarketplace}`);
