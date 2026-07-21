import {
  applyWatchdogTick,
  type ApplyWatchdogOptions,
  type WatchdogTickResult,
} from "./watchdog.js";
import type { SessionRegistry } from "../session/SessionRegistry.js";

/** Default stale-session TTL (FR-06 / RR-04.2) — 10 minutes. */
export const DEFAULT_STALE_SESSION_MS = 10 * 60 * 1000;

export type ReconcileOptions = ApplyWatchdogOptions & {
  now?: () => number;
  /** Max age of `lastSeenAt` before GC (default 10 minutes). */
  staleSessionMs?: number;
};

export type ReconcileResult = WatchdogTickResult & {
  staleRemoved: string[];
};

/**
 * Full-registry reconciliation (PC-203 / RR-04.2–.3):
 * 1. PID liveness (dead / suspended / running) via {@link applyWatchdogTick}
 * 2. Stale TTL — sessions with no events for `staleSessionMs` are removed
 *
 * Call on every watchdog tick, every incoming control message, and at boot
 * after snapshot restore.
 */
export function reconcileRegistry(
  registry: SessionRegistry,
  options: ReconcileOptions = {},
): ReconcileResult {
  const now = options.now ?? Date.now;
  const staleSessionMs = options.staleSessionMs ?? DEFAULT_STALE_SESSION_MS;

  const live = applyWatchdogTick(registry, options);
  const staleRemoved: string[] = [];

  if (staleSessionMs > 0) {
    const cutoff = now() - staleSessionMs;
    for (const session of registry.list()) {
      if (session.lastSeenAt < cutoff) {
        registry.stop(session.sessionId);
        staleRemoved.push(session.sessionId);
      }
    }
  }

  return {
    changed: live.changed || staleRemoved.length > 0,
    removed: live.removed,
    paused: live.paused,
    resumed: live.resumed,
    staleRemoved,
  };
}
