export type SessionRecord = {
  sessionId: string;
  startedAt: number;
  lastSeenAt: number;
  claudePid?: number | undefined;
  starttime?: string | undefined;
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
      return { created: false, activeCount: this.sessions.size };
    }
    this.sessions.set(input.sessionId, {
      sessionId: input.sessionId,
      startedAt: now,
      lastSeenAt: now,
      ...(input.claudePid !== undefined ? { claudePid: input.claudePid } : {}),
      ...(input.starttime !== undefined ? { starttime: input.starttime } : {}),
    });
    return { created: true, activeCount: this.sessions.size };
  }

  /** Touch lastSeenAt for any known session. */
  touch(sessionId: string): void {
    const existing = this.sessions.get(sessionId);
    if (existing) existing.lastSeenAt = this.now();
  }

  /**
   * Remove a session. Unknown / repeat stops are harmless no-ops.
   * Returns whether an active session was removed.
   */
  stop(sessionId: string): { removed: boolean; activeCount: number } {
    const removed = this.sessions.delete(sessionId);
    return { removed, activeCount: this.sessions.size };
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
