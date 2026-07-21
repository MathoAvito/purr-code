import {
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";

export function pidfilePath(runtimeDir: string): string {
  return join(runtimeDir, "daemon.pid");
}

export function writePidfile(runtimeDir: string, pid: number): void {
  mkdirSync(runtimeDir, { recursive: true });
  const target = pidfilePath(runtimeDir);
  const tmp = `${target}.${process.pid}.tmp`;
  writeFileSync(tmp, `${pid}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, target);
}

export function readPidfile(runtimeDir: string): number | null {
  const target = pidfilePath(runtimeDir);
  if (!existsSync(target)) return null;
  try {
    const raw = readFileSync(target, "utf8").trim();
    const pid = Number(raw);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export function removePidfile(runtimeDir: string): void {
  const target = pidfilePath(runtimeDir);
  try {
    unlinkSync(target);
  } catch {
    // ignore
  }
}
