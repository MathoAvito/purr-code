/**
 * Platform-correct control endpoints for tests (ADR 0003).
 * - Unix: UDS file under an isolated temp runtime dir
 * - Windows: named pipe with a unique suffix (production uses SID; tests must not collide)
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect } from "vitest";

export type TestControlEndpoint = {
  path: string;
  kind: "uds" | "named-pipe";
  /** Present when a temp dir was created for UDS. */
  runtimeDir?: string;
  /** Windows isolation suffix (also useful to pass into Daemon). */
  windowsPipeSuffix?: string;
  cleanup: () => Promise<void>;
};

/** Unique Windows pipe suffix for one test instance (not the production SID). */
export function uniqueWindowsPipeSuffix(label = "t"): string {
  return `${label}-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export async function createTestControlEndpoint(
  label = "purrcode-ctrl",
): Promise<TestControlEndpoint> {
  if (process.platform === "win32") {
    const tag = label.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "t";
    const windowsPipeSuffix = uniqueWindowsPipeSuffix(tag);
    return {
      path: `\\\\.\\pipe\\purrcode-${windowsPipeSuffix}`,
      kind: "named-pipe",
      windowsPipeSuffix,
      cleanup: () => Promise.resolve(),
    };
  }

  const runtimeDir = await mkdtemp(join(tmpdir(), `${label}-`));
  return {
    path: join(runtimeDir, "control.sock"),
    kind: "uds",
    runtimeDir,
    cleanup: async () => {
      await rm(runtimeDir, { recursive: true, force: true });
    },
  };
}

/** Assert the control path matches the OS transport (not Unix-only). */
export function expectPlatformControlPath(path: string): void {
  if (process.platform === "win32") {
    expect(path.startsWith("\\\\.\\pipe\\purrcode-")).toBe(true);
  } else {
    expect(path).toContain("control.sock");
  }
}

/**
 * Options to pass into Daemon / ensureDaemonRunning so Windows tests do not
 * collide on the production SID pipe.
 */
export function daemonIsolationOptions(runtimeDir: string): {
  runtimeDir: string;
  windowsPipeSuffix?: string;
  env?: NodeJS.ProcessEnv;
} {
  if (process.platform !== "win32") {
    return { runtimeDir };
  }
  const windowsPipeSuffix = uniqueWindowsPipeSuffix("d");
  return {
    runtimeDir,
    windowsPipeSuffix,
    env: { ...process.env, PURRCODE_WINDOWS_PIPE_SUFFIX: windowsPipeSuffix },
  };
}
