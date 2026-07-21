import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import type { SessionRecord } from "./SessionRegistry.js";

export const SNAPSHOT_VERSION = 1 as const;

export type RegistrySnapshot = {
  v: typeof SNAPSHOT_VERSION;
  savedAt: number;
  sessions: SessionRecord[];
};

export function snapshotPath(runtimeDir: string): string {
  return join(runtimeDir, "registry.json");
}

/** Atomic snapshot write: temp file + rename (PC-106). */
export function writeRegistrySnapshot(runtimeDir: string, sessions: SessionRecord[]): void {
  mkdirSync(runtimeDir, { recursive: true });
  const target = snapshotPath(runtimeDir);
  const tmp = `${target}.${process.pid}.tmp`;
  const body: RegistrySnapshot = {
    v: SNAPSHOT_VERSION,
    savedAt: Date.now(),
    sessions,
  };
  writeFileSync(tmp, `${JSON.stringify(body)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, target);
}

export type LoadSnapshotResult =
  { ok: true; snapshot: RegistrySnapshot } | { ok: false; reason: "missing" | "corrupt" };

/**
 * Load snapshot. Unreadable/corrupt JSON or wrong schema → `{ ok: false }`
 * (safe regeneration — never throws).
 */
export function loadRegistrySnapshot(runtimeDir: string): LoadSnapshotResult {
  const target = snapshotPath(runtimeDir);
  if (!existsSync(target)) return { ok: false, reason: "missing" };
  let raw: string;
  try {
    raw = readFileSync(target, "utf8");
  } catch {
    return { ok: false, reason: "corrupt" };
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isValidSnapshot(parsed)) return { ok: false, reason: "corrupt" };
    return { ok: true, snapshot: parsed };
  } catch {
    return { ok: false, reason: "corrupt" };
  }
}

function isValidSnapshot(value: unknown): value is RegistrySnapshot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const o = value as Record<string, unknown>;
  if (o.v !== SNAPSHOT_VERSION) return false;
  if (typeof o.savedAt !== "number") return false;
  if (!Array.isArray(o.sessions)) return false;
  for (const s of o.sessions) {
    if (typeof s !== "object" || s === null) return false;
    const rec = s as Record<string, unknown>;
    if (typeof rec.sessionId !== "string" || rec.sessionId.length === 0) return false;
    if (typeof rec.startedAt !== "number" || typeof rec.lastSeenAt !== "number") return false;
  }
  return true;
}

/**
 * Keep sessions whose PID is still alive (kill 0). Missing PID → keep
 * (cannot prove dead). Dead PID → drop.
 */
export function filterLiveSessions(
  sessions: SessionRecord[],
  isAlive: (pid: number) => boolean = defaultIsAlive,
): SessionRecord[] {
  return sessions.filter((s) => {
    if (s.claudePid === undefined) return true;
    return isAlive(s.claudePid);
  });
}

function defaultIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
