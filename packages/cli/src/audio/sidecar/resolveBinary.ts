import { accessSync, constants } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type SidecarPlatform = {
  platform: NodeJS.Platform;
  arch: string;
};

/** Map Node platform/arch → `@purrcode/sidecar-<os>-<cpu>` package name. */
export function sidecarPackageName(
  platform: SidecarPlatform = {
    platform: process.platform,
    arch: process.arch,
  },
): string | null {
  const os =
    platform.platform === "linux"
      ? "linux"
      : platform.platform === "darwin"
        ? "darwin"
        : platform.platform === "win32"
          ? "win32"
          : null;
  if (!os) return null;

  const cpu = platform.arch === "x64" || platform.arch === "arm64" ? platform.arch : null;
  if (!cpu) return null;
  // We only ship win32-x64 / linux-x64 / darwin-{x64,arm64}.
  if (os === "linux" && cpu !== "x64") return null;
  if (os === "win32" && cpu !== "x64") return null;

  return `@purrcode/sidecar-${os}-${cpu}`;
}

function binaryFileName(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "purr-sidecar.exe" : "purr-sidecar";
}

/**
 * Resolve the platform sidecar binary path.
 *
 * Order:
 * 1. `PURRCODE_SIDECAR_BIN` override (tests / custom installs)
 * 2. `require.resolve` of the matching optionalDependency package
 * 3. Monorepo fallback: `packages/sidecar-<os>-<cpu>/bin/...` next to this source tree
 */
export function resolveSidecarBinaryPath(
  options: {
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    arch?: string;
    /** Injected for tests. */
    requireResolve?: (id: string) => string;
  } = {},
): string | null {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const override = env.PURRCODE_SIDECAR_BIN;
  if (override !== undefined && override !== "") {
    return isExecutableFile(override, platform) ? override : null;
  }

  const arch = options.arch ?? process.arch;
  const pkg = sidecarPackageName({ platform, arch });
  if (!pkg) return null;

  const binName = binaryFileName(platform);
  const resolve = options.requireResolve ?? createRequire(import.meta.url).resolve;

  try {
    const pkgJson = resolve(`${pkg}/package.json`);
    const candidate = join(dirname(pkgJson), "bin", binName);
    if (isExecutableFile(candidate, platform)) return candidate;
  } catch {
    // optionalDependency absent on this platform / not built yet
  }

  // Plugin-bundled binary: ${CLAUDE_PLUGIN_ROOT}/vendor/sidecar/<bin>
  const pluginRoot = env.CLAUDE_PLUGIN_ROOT?.trim();
  if (pluginRoot) {
    const pluginCandidate = join(pluginRoot, "vendor", "sidecar", binName);
    if (isExecutableFile(pluginCandidate, platform)) return pluginCandidate;
  }

  // Monorepo / workspace fallback when optionalDeps aren't linked with a bin yet.
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // packages/cli/src/audio/sidecar → repo root is ../../../../..
    const repoRoot = join(here, "..", "..", "..", "..", "..");
    const candidate = join(
      repoRoot,
      "packages",
      `sidecar-${platform === "win32" ? "win32" : platform === "darwin" ? "darwin" : "linux"}-${arch === "arm64" ? "arm64" : "x64"}`,
      "bin",
      binName,
    );
    if (isExecutableFile(candidate, platform)) return candidate;
  } catch {
    // ignore
  }

  return null;
}

export function isExecutableFile(
  path: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  try {
    accessSync(path, constants.F_OK);
    if (platform === "win32") {
      // Windows has no POSIX execute bit; presence is enough.
      accessSync(path, constants.R_OK);
      return true;
    }
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
