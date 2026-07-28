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
  /**
   * Max age of `lastSeenAt` before a live (non-suspended) session's turn is
   * treated as abandoned and playback released (ADR 0008). The record is kept
   * (a later event resurrects it via {@link SessionRegistry.touch}); the stale
   * TTL is the eventual GC. `0` disables. Must be < `staleSessionMs` to matter.
   */
  abandonedTurnMs?: number;
};

export type ReconcileResult = WatchdogTickResult & {
  staleRemoved: string[];
  /** Sessions newly flagged idle by the abandoned-turn timeout. */
  idled: string[];
};

/**
 * Full-registry reconciliation (PC-203 / RR-04.2–.3):
 * 1. PID liveness (dead / suspended / running) via {@link applyWatchdogTick}
 * 2. Stale TTL — sessions with no events for `staleSessionMs` are removed
 *
 * Call on every watchdog tick, every incoming control message, and at boot
 * after snapshot restore. Async so platform snapshot I/O never stalls the
 * control-pipe accept loop.
 */
export async function reconcileRegistry(
  registry: SessionRegistry,
  options: ReconcileOptions = {},
): Promise<ReconcileResult> {
  const now = options.now ?? Date.now;
  const staleSessionMs = options.staleSessionMs ?? DEFAULT_STALE_SESSION_MS;
  const abandonedTurnMs = options.abandonedTurnMs ?? 0;

  const live = await applyWatchdogTick(registry, options);
  const idled: string[] = [];
  const staleRemoved: string[] = [];

  // Abandoned-turn release (ADR 0008): a live session with no event for
  // `abandonedTurnMs` fades out. Skip suspended sessions — their pause/resume
  // is owned by the liveness watchdog + stale TTL (PC-207). Runs before the
  // stale GC so an idled session is still present for later resurrection.
  if (abandonedTurnMs > 0) {
    const cutoff = now() - abandonedTurnMs;
    for (const session of registry.list()) {
      if (session.paused) continue;
      if (session.lastSeenAt < cutoff && registry.setIdle(session.sessionId, true)) {
        idled.push(session.sessionId);
      }
    }
  }

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
    changed: live.changed || idled.length > 0 || staleRemoved.length > 0,
    removed: live.removed,
    paused: live.paused,
    resumed: live.resumed,
    staleRemoved,
    idled,
  };
}
