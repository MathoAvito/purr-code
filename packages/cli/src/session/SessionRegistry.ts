export type SessionRecord = {
  sessionId: string;
  startedAt: number;
  lastSeenAt: number;
  claudePid?: number | undefined;
  starttime?: string | undefined;
  /**
   * Owner process is suspended (SIGSTOP). Session stays registered with its
   * turn open, but does not contribute to playback refcount (PC-202).
   */
  paused?: boolean | undefined;
  /**
   * Turn looks abandoned: no hook event (not even a tool heartbeat) for
   * `abandonedTurnSeconds`. Playback is released but the record is kept so a
   * later event can resurrect it; the stale TTL is the eventual GC. Managed by
   * reconciliation only; cleared by any incoming event via {@link touch}.
   * Independent of `paused` (owned by the liveness watchdog) — ADR 0008.
   */
  idle?: boolean | undefined;
};

export type SessionStartInput = {
  sessionId: string;
  claudePid?: number | undefined;
  starttime?: string | undefined;
};

/**
 * In-memory session registry keyed by `session_id` (PC-105 / FR-05).
 * Duplicate starts are idempotent; unknown stops are no-ops (RR-03).
 */
export class SessionRegistry {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly now: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.sessions.size;
  }

  /** Sessions that should drive purr playback (registered, not paused, not idle). */
  playbackCount(): number {
    let n = 0;
    for (const s of this.sessions.values()) {
      if (!s.paused && !s.idle) n++;
    }
    return n;
  }

  list(): SessionRecord[] {
    return [...this.sessions.values()];
  }

  get(sessionId: string): SessionRecord | undefined {
    return this.sessions.get(sessionId);
  }

  /** Returns whether this call newly activated a session (0→1 contribution). */
  start(input: SessionStartInput): { created: boolean; activeCount: number } {
    const now = this.now();
    const existing = this.sessions.get(input.sessionId);
    if (existing) {
      existing.lastSeenAt = now;
      if (input.claudePid !== undefined) existing.claudePid = input.claudePid;
      if (input.starttime !== undefined) existing.starttime = input.starttime;
      // A fresh start event implies the turn is active again.
      existing.paused = false;
      delete existing.idle;
      return { created: false, activeCount: this.playbackCount() };
    }
    this.sessions.set(input.sessionId, {
      sessionId: input.sessionId,
      startedAt: now,
      lastSeenAt: now,
      ...(input.claudePid !== undefined ? { claudePid: input.claudePid } : {}),
      ...(input.starttime !== undefined ? { starttime: input.starttime } : {}),
    });
    return { created: true, activeCount: this.playbackCount() };
  }

  /**
   * Touch lastSeenAt for any known session and clear the abandoned-turn `idle`
   * flag — any incoming event (including a tool heartbeat) means the turn is
   * still live. Returns whether the session was resurrected from idle.
   */
  touch(sessionId: string): boolean {
    const existing = this.sessions.get(sessionId);
    if (!existing) return false;
    existing.lastSeenAt = this.now();
    if (existing.idle) {
      delete existing.idle;
      return true;
    }
    return false;
  }

  /**
   * Mark a session idle / active for abandoned-turn playback release (ADR 0008).
   * Returns whether the flag actually changed.
   */
  setIdle(sessionId: string, idle: boolean): boolean {
    const existing = this.sessions.get(sessionId);
    if (!existing) return false;
    const was = Boolean(existing.idle);
    if (was === idle) return false;
    if (idle) existing.idle = true;
    else delete existing.idle;
    return true;
  }

  /**
   * Mark a session paused / unpaused for suspend-aware playback (PC-202).
   * Returns whether the flag actually changed.
   */
  setPaused(sessionId: string, paused: boolean): boolean {
    const existing = this.sessions.get(sessionId);
    if (!existing) return false;
    const was = Boolean(existing.paused);
    if (was === paused) return false;
    if (paused) existing.paused = true;
    else delete existing.paused;
    return true;
  }

  /**
   * Remove a session. Unknown / repeat stops are harmless no-ops.
   * Returns whether an active session was removed.
   */
  stop(sessionId: string): { removed: boolean; activeCount: number } {
    const removed = this.sessions.delete(sessionId);
    return { removed, activeCount: this.playbackCount() };
  }

  clear(): void {
    this.sessions.clear();
  }

  /** Replace contents (snapshot restore). */
  replaceAll(records: SessionRecord[]): void {
    this.sessions.clear();
    for (const r of records) {
      this.sessions.set(r.sessionId, { ...r });
    }
  }
}
