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

  /** Sessions that should drive purr playback (registered and not paused). */
  playbackCount(): number {
    let n = 0;
    for (const s of this.sessions.values()) {
      if (!s.paused) n++;
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

  /** Touch lastSeenAt for any known session. */
  touch(sessionId: string): void {
    const existing = this.sessions.get(sessionId);
    if (existing) existing.lastSeenAt = this.now();
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
