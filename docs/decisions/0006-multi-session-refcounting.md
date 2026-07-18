# 0006 — Multi-session refcounting & watchdog prototype (Linux)

- **Status:** Accepted — Linux findings; macOS + Windows verification outstanding (flagged for PC-009)
- **Date:** 2026-07-18
- **Story:** PC-006
- **PRD refs:** FR-04 (multi-session), FR-05 (daemon lifecycle), RR-04 (watchdog), §19 Phase 0 exit criterion

## Question

Do the PC-001 hook events plus the PC-003 transport plus the PC-002 identity
scheme actually compose into correct refcounting with *real* concurrent
Claude Code sessions? Two acceptance scenarios: (a) interleaved turns across
two terminals — purr continues until the **last** active session stops;
(b) a terminal SIGKILLed mid-turn — watchdog fades out ≤ 5 s, no orphaned
player.

## Evidence

Claude Code v2.1.214 on Linux (Ubuntu, kernel 6.17.0-40), Node v20.20.2. Two
real `claude` TUIs in PTYs against the PC-001 mock API (8 s stretched turns),
exec-form async hooks (`UserPromptSubmit`/`Stop`/`StopFailure`/`SessionEnd`)
feeding a prototype daemon (`proto-daemon.mjs`) over UDS. The "player" is
fake — state transitions are logged, not rendered to a sound card. Raw logs
in [`spikes/pc-006-multi-session/`](../../spikes/pc-006-multi-session/).
**macOS and Windows were not tested — nothing below is verified there.**

1. **Interleaved turns refcount correctly** (`player-interleave.jsonl`).
   Session A turn-start `t=0.09` → player **start** (0→1). Session B
   turn-start `t=3.59` (1→2, no player event). A's `Stop` at `t=8.02` (2→1,
   player keeps playing). B's `Stop` at `t=11.62` (1→0) → **fade + stop**.
   Exactly one start/stop pair for two overlapping turns; purr outlived the
   first session's turn and ended at the last one's stop, with both sessions
   still connected.
2. **Kill mid-turn: watchdog fade in ≈ 0.6 s** (`player-kill.jsonl`).
   SIGKILL of the claude process group mid-turn emitted **no** hook events
   (re-confirms ADR 0001 #4 on v2.1.214). The 2 s-cadence watchdog evicted
   the session on its next poll — fade + stop ~0.6 s after the kill, worst
   case one cadence ≈ 2 s, comfortably inside the ≤ 5 s criterion. Daemon
   idle-exited 6 s later and removed its socket: no orphaned player, no
   orphaned daemon (FR-05).
3. **Zombie state must count as dead.** After SIGKILL, while the PTY parent
   had not yet reaped the child, `/proc/<pid>/stat` was still readable with
   the **original starttime** but state `Z`. The ADR 0002 identity check
   (ENOENT / starttime mismatch) alone kept the session "alive" for the
   whole 16 s the parent held the corpse — the first kill run only faded at
   parent teardown. Fix: treat state `Z` (and `X`) as *gone*. With that,
   detection is one poll. This **amends ADR 0002's liveness classification**.
4. **String-form hooks break refcounting operationally.** A first run with
   string-form hooks handed the daemon the `/bin/sh -c` wrapper's PID; the
   shell exits in milliseconds, so the watchdog evicted every session within
   one cycle and purr died mid-turn. Exec form (ppid = claude, ADR 0002 #1)
   fixed it. This upgrades "exec form preferred" to *load-bearing for
   correctness*, not just hygiene.
5. **Cold start under hook pressure.** No daemon was pre-started in any run;
   the first `UserPromptSubmit` hook spawned it detached and delivered its
   message via connect-retry ~80 ms later (ADR 0003 pattern), including after
   a previous daemon instance had idle-exited and unlinked the socket.

## Decision

- **Refcount = count of sessions with an active turn**, not of connected
  sessions: `UserPromptSubmit` → +active, `Stop`/`StopFailure` → −active,
  `SessionEnd` → deregister. Player runs iff active > 0. Validated end-to-end.
- **Liveness classification (amends ADR 0002):** *gone* = ENOENT ∨ starttime
  mismatch ∨ state `Z`/`X`; *suspended* = state `T`; else *running*. PC-201
  must implement all three clauses of *gone*.
- **Watchdog cadence 2 s is sufficient** for the ≤ 5 s Phase 0 bound with
  margin; keep 2 s as the default in PC-201/202.
- **Exec-form hook config is mandatory** (not merely preferred) — string form
  silently destroys session tracking.
- **Idle-exit after last deregistration** (daemon unlinks socket and exits)
  is the no-orphan mechanism; keep the grace window ≥ one watchdog cycle so
  back-to-back turns don't churn the daemon.
- Rejected alternative: counting connected sessions instead of active turns —
  would purr forever for idle-but-open terminals; contradicts FR-04.

## Consequences

- Backlog impact (flag for PC-009):
  - PC-201 (liveness): add the zombie clause; a starttime-only check is a
    proven correctness bug on Linux.
  - PC-107 (hook adapter): ship exec form only; refuse/warn on string form.
  - PC-202/203 (watchdog + TTL): 2 s cadence confirmed; TTL remains the
    backstop for pathological cases (e.g. zombie *with* reused starttime).
- PRD impact: §19 Phase 0 exit criterion (kill mid-turn → fade ≤ 5 s, no
  orphan) **demonstrated on Linux**. FR-04 refcount semantics validated with
  real event streams.
- Follow-ups: rerun both scenarios on macOS/Windows at PC-009 (zombie
  semantics are Linux-specific; Windows existence-check path untested).
