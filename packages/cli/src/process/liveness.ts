import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

/**
 * Process liveness classification for the watchdog (PC-201 / RR-04.1).
 *
 * Identity is always `(pid, starttime)` (ADR 0002). Classification
 * (ADR 0006 amends ADR 0002):
 *   dead      = missing ∨ starttime mismatch ∨ state Z/X
 *   suspended = state T (primary letter)
 *   running   = otherwise
 *
 * Windows is existence-only (no suspend equivalent; starttime not verified).
 */

export type ProcessLiveness = "running" | "suspended" | "dead";

/** Stable process identity — starttime is opaque (Linux ticks / macOS lstart). */
export type ProcessIdentity = {
  pid: number;
  starttime: string;
};

/** Raw snapshot from the platform (null if the PID is gone). */
export type ProcessSnapshot = {
  /** Full state token from the OS (may include macOS flag letters). */
  state: string;
  starttime: string;
};

export type ClassifyOptions = {
  /** Override platform detection (tests). */
  platform?: NodeJS.Platform;
  /** Inject snapshot reader (tests). */
  readSnapshot?: (pid: number) => ProcessSnapshot | null;
};

/**
 * Parse Linux `/proc/[pid]/stat` after the `comm` field.
 * Handles comm names containing spaces and parentheses by locating the
 * final `)` before the state field (man proc_pid_stat).
 */
export function parseLinuxStat(raw: string): ProcessSnapshot | null {
  const closeParen = raw.lastIndexOf(")");
  if (closeParen < 0) return null;
  // ") " then fields: state(0) … starttime(19) = man field 22
  const rest = raw
    .slice(closeParen + 2)
    .trimStart()
    .split(/\s+/);
  const state = rest[0];
  const starttime = rest[19];
  if (!state || starttime === undefined || starttime === "") return null;
  return { state, starttime };
}

/** Primary run-state letter (macOS may append N/s flags — ADR 0002). */
export function primaryStateLetter(state: string): string {
  return state.charAt(0);
}

function readLinuxSnapshot(pid: number): ProcessSnapshot | null {
  try {
    const raw = readFileSync(`/proc/${pid}/stat`, "utf8");
    return parseLinuxStat(raw);
  } catch {
    return null;
  }
}

/**
 * macOS / other Unix: one `ps` call for state + lstart identity token.
 * Exec-form only (argument array).
 */
function readPsSnapshot(pid: number): ProcessSnapshot | null {
  try {
    const out = execFileSync("ps", ["-o", "state=,lstart=", "-p", String(pid)], {
      encoding: "utf8",
      timeout: 2_000,
    }).trim();
    if (!out) return null;
    const m = out.match(/^(\S+)\s+(.+)$/);
    if (!m) return null;
    const state = m[1];
    const starttime = m[2]?.trim();
    if (!state || !starttime) return null;
    return { state, starttime };
  } catch {
    return null;
  }
}

function windowsExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Read a platform snapshot for `pid`, or null if gone / unreadable. */
export function readProcessSnapshot(
  pid: number,
  platform: NodeJS.Platform = process.platform,
): ProcessSnapshot | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (platform === "linux") return readLinuxSnapshot(pid);
  if (platform === "win32") {
    // Existence-only — no starttime available via portable Node APIs.
    return windowsExists(pid) ? { state: "R", starttime: "" } : null;
  }
  // darwin and other Unix
  return readPsSnapshot(pid);
}

/**
 * Opaque start-time token for registration messages (hook → daemon).
 * Linux: `/proc` field 22. macOS: `ps` lstart. Windows: undefined.
 */
export function readStarttimeToken(
  pid: number,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  if (platform === "win32") return undefined;
  const snap = readProcessSnapshot(pid, platform);
  if (!snap || snap.starttime === "") return undefined;
  return snap.starttime;
}

/**
 * Classify `identity` as running / suspended / dead.
 * On Windows, only existence is checked (never suspended; starttime unused).
 */
export function classifyProcess(
  identity: ProcessIdentity,
  options: ClassifyOptions = {},
): ProcessLiveness {
  const platform = options.platform ?? process.platform;
  const read = options.readSnapshot ?? ((pid) => readProcessSnapshot(pid, platform));

  if (!Number.isInteger(identity.pid) || identity.pid <= 0) return "dead";

  if (platform === "win32") {
    return windowsExists(identity.pid) ? "running" : "dead";
  }

  const snap = read(identity.pid);
  if (snap === null) return "dead";

  // PID-reuse guard — required (ADR 0002).
  if (snap.starttime !== identity.starttime) return "dead";

  const letter = primaryStateLetter(snap.state);
  // Zombie / dead — do not treat as alive (ADR 0006).
  if (letter === "Z" || letter === "X") return "dead";
  if (letter === "T") return "suspended";
  return "running";
}
