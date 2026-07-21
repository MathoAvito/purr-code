import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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
 *
 * Hot paths (watchdog / reconcile) must use {@link readProcessSnapshots} —
 * async, batched — so macOS `ps` never blocks the Node event loop.
 * Sync single-pid helpers remain for the one-shot hook registration path.
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

/**
 * Parse one or more `ps -o pid=,state=,lstart=` lines (macOS / BSD).
 * Missing PIDs simply omit a line — callers treat map misses as dead.
 */
export function parsePsPidStateLstart(output: string): Map<number, ProcessSnapshot> {
  const map = new Map<number, ProcessSnapshot>();
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^(\d+)\s+(\S+)\s+(.+)$/);
    if (!m) continue;
    const pid = Number(m[1]);
    const state = m[2];
    const starttime = m[3]?.trim();
    if (!Number.isInteger(pid) || pid <= 0 || !state || !starttime) continue;
    map.set(pid, { state, starttime });
  }
  return map;
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
 * Sync single-pid `ps` — for hook one-shot only. Prefer
 * {@link readProcessSnapshots} on daemon hot paths.
 */
function readPsSnapshotSync(pid: number): ProcessSnapshot | null {
  try {
    const out = execFileSync("ps", ["-o", "pid=,state=,lstart=", "-p", String(pid)], {
      encoding: "utf8",
      timeout: 2_000,
    });
    return parsePsPidStateLstart(out).get(pid) ?? null;
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
  return readPsSnapshotSync(pid);
}

/**
 * Batch-read snapshots for many PIDs without blocking the event loop.
 * - Linux: concurrent `/proc` reads via `fs.promises`
 * - macOS/BSD: one async `ps` for all PIDs
 * - Windows: existence-only `kill(0)` (no spawn)
 *
 * PIDs that are gone are omitted from the map (treat as dead).
 */
export async function readProcessSnapshots(
  pids: readonly number[],
  platform: NodeJS.Platform = process.platform,
): Promise<Map<number, ProcessSnapshot>> {
  const unique = [...new Set(pids.filter((p) => Number.isInteger(p) && p > 0))];
  const map = new Map<number, ProcessSnapshot>();
  if (unique.length === 0) return map;

  if (platform === "win32") {
    for (const pid of unique) {
      if (windowsExists(pid)) map.set(pid, { state: "R", starttime: "" });
    }
    return map;
  }

  if (platform === "linux") {
    await Promise.all(
      unique.map(async (pid) => {
        try {
          const raw = await readFile(`/proc/${pid}/stat`, "utf8");
          const snap = parseLinuxStat(raw);
          if (snap) map.set(pid, snap);
        } catch {
          // gone
        }
      }),
    );
    return map;
  }

  // darwin / other Unix — single async ps (exec-form, no shell).
  try {
    const { stdout } = await execFileAsync(
      "ps",
      ["-o", "pid=,state=,lstart=", "-p", unique.join(",")],
      { encoding: "utf8", timeout: 2_000, maxBuffer: 256 * 1024 },
    );
    for (const [pid, snap] of parsePsPidStateLstart(stdout)) {
      map.set(pid, snap);
    }
  } catch {
    // Entire ps failed (e.g. all PIDs gone) → empty map → all dead.
  }
  return map;
}

/**
 * Opaque start-time token for registration messages (hook → daemon).
 * Linux: `/proc` field 22. macOS: `ps` lstart. Windows: undefined.
 *
 * Sync by design: the hook is a one-shot process and may block briefly.
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
