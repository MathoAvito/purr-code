import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { ensureRuntimeDir, type EnsureRuntimeDirOptions } from "../runtime/index.js";

export type ResolveControlPipeOptions = EnsureRuntimeDirOptions & {
  /** Override runtime directory (tests). When set, skips ensureRuntimeDir. */
  runtimeDir?: string;
  /** Windows pipe suffix override (SID/USERNAME). */
  windowsPipeSuffix?: string;
};

/**
 * Resolve the control-pipe endpoint.
 *
 * - Unix: `<runtimeDir>/control.sock` (runtime dir already per-UID per FR-05)
 * - Windows: `\\.\pipe\purrcode-<SID|USERNAME>` (ADR 0003)
 *
 * Isolation override (tests / rare multi-instance): `windowsPipeSuffix` option
 * or `PURRCODE_WINDOWS_PIPE_SUFFIX` env. Production leaves these unset so the
 * SID (or USERNAME fallback) names the single per-user pipe.
 */
export async function resolveControlPipePath(
  options: ResolveControlPipeOptions = {},
): Promise<{ path: string; runtimeDir: string; kind: "uds" | "named-pipe" }> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;

  if (platform === "win32") {
    const suffix =
      options.windowsPipeSuffix?.trim() ||
      env.PURRCODE_WINDOWS_PIPE_SUFFIX?.trim() ||
      resolveWindowsPipeSuffix(env);
    const path = `\\\\.\\pipe\\purrcode-${suffix}`;
    const runtimeDir = options.runtimeDir ?? (await ensureRuntimeDir(options));
    return { path, runtimeDir, kind: "named-pipe" };
  }

  const runtimeDir = options.runtimeDir ?? (await ensureRuntimeDir(options));
  return {
    path: join(runtimeDir, "control.sock"),
    runtimeDir,
    kind: "uds",
  };
}

/** Best-effort Windows SID via `whoami /user` (ADR 0003). Falls back to USERNAME. */
export function resolveWindowsPipeSuffix(
  env: NodeJS.ProcessEnv = process.env,
  execWhoami: () => string = defaultWhoami,
): string {
  try {
    const out = execWhoami();
    const sid = out.split(",").pop()?.replace(/"/g, "").trim();
    if (sid?.startsWith("S-")) return sid;
  } catch {
    // fall through
  }
  return env.USERNAME?.trim() || "user";
}

function defaultWhoami(): string {
  return execFileSync("whoami", ["/user", "/fo", "csv", "/nh"], { encoding: "utf8" });
}
