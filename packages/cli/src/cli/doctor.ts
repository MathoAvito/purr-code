import { collectDoctorChecks, defaultDoctorHome, type DoctorDeps } from "./doctorChecks.js";
import type { ResolveConfigDirOptions } from "../config/index.js";
import { ensureDaemonRunning } from "../daemon/spawn.js";
import { style } from "./style.js";
import type { RunCliResult } from "./runCli.js";

export type RunDoctorOptions = {
  env?: NodeJS.ProcessEnv;
  out?: (line: string) => void;
  err?: (line: string) => void;
  ensure?: typeof ensureDaemonRunning;
  configDir?: ResolveConfigDirOptions;
  /** Extra deps for fixture tests. */
  deps?: Partial<DoctorDeps>;
};

function marker(status: "ok" | "warn" | "fail", env: NodeJS.ProcessEnv): string {
  if (status === "ok") return style.ok("ok ", env);
  if (status === "warn") return style.warn("!  ", env);
  return style.err("x  ", env);
}

/**
 * `purrcode doctor` — FR-10 diagnostic report (PC-307).
 */
export async function runDoctor(options: RunDoctorOptions = {}): Promise<RunCliResult> {
  const env = options.env ?? process.env;
  const out = options.out ?? ((line: string) => process.stdout.write(`${line}\n`));

  const base: DoctorDeps = {
    env,
    platform: process.platform,
    home: options.configDir?.home ?? defaultDoctorHome(env),
    ...(options.configDir !== undefined ? { configDir: options.configDir } : {}),
    ...(options.ensure !== undefined ? { ensureDaemon: options.ensure } : {}),
  };

  const report = await collectDoctorChecks({ ...base, ...options.deps });

  out(style.bold("PurrCode Doctor", env));
  out("");
  for (const check of report.checks) {
    out(`${marker(check.status, env)}${check.summary}`);
    if (check.fix && check.status !== "ok") {
      out(style.dim(`    fix: ${check.fix}`, env));
    }
  }
  out("");
  out(report.healthy ? style.ok(report.verdict, env) : style.err(report.verdict, env));
  return { exitCode: report.exitCode };
}
