# 0008 — Abandoned-turn (Esc) recovery: tool-heartbeat + short TTL

- **Status:** Accepted — Linux verified (2026-07-28); macOS/Windows outstanding
- **Date:** 2026-07-28
- **Story:** issue #36 ("[bug] Aborting Claude in the middle of a session (esc) continues the purring")
- **PRD refs:** §7 (abandoned-turn gap) / §8 (Interrupted session) / RR-04
- **Extends:** ADR 0001 (Esc fires no Stop)

## Question

Issue #36: pressing Esc mid-turn (the interactive TUI stays alive) leaves the
purr playing. What signal can PurrCode use to stop a turn that the user aborted
while the Claude Code process keeps running, and how do we recover promptly
without cutting a legitimately long turn?

## Evidence

Claude Code **v2.1.220** on Linux (kernel 6.17), Node v20.20.2. Reused the
PC-001 PTY harness (`spikes/pc-001-hook-payload/`) with a `Notification` hook
added, driving the TUI against the SSE mock. Two scenarios, hook firings
captured with wall-clock timestamps:

1. **Normal completed turn** — `SessionStart` → `UserPromptSubmit` → `Stop`
   (instant). Then, exactly **60 s** after `Stop`, `Notification` fired with
   `message: "Claude is waiting for your input"` (the `idle_prompt` matcher).
2. **Esc mid-turn** — `UserPromptSubmit` fired, then the turn was interrupted.
   For the next **82 s** of idle: **no `Stop`, no `StopFailure`, and no
   `Notification`.** Only `SessionEnd` fired, and only when the process exited.

Binary string scan of `claude.exe` 2.1.220: hook events are the standard set;
there is **no** `Interrupt`/`Abort`/`TurnEnd` hook event. Upstream feature
requests confirm the gap:
[anthropics/claude-code#9516](https://github.com/anthropics/claude-code/issues/9516)
(no user-interrupt hook),
[#11189](https://github.com/anthropics/claude-code/issues/11189)
(Notification carries no interrupt reason).

**Conclusion:** Claude Code emits **zero prompt-level event** when a turn is
aborted with Esc while the process stays alive. The 60 s `idle_prompt`
Notification is armed by `Stop`; an interrupted turn never fires `Stop`, so it
never arms. Before this change, the *only* thing that eventually stopped the
purr was the 10-minute stale TTL (PC-203) — hence the bug.

**Not tested:** macOS and Windows Notification/idle timing. The mechanism
chosen does not depend on them.

## Decision

Because no interrupt event exists, detection must be a PurrCode-side heuristic.
Every purely-local heuristic fails around one hero case (a long silent
"thinking" turn):

- **CPU-idle watchdog** — false-cuts during long server-side thinking where the
  client blocks on the socket with ~0 local CPU. Rejected: kills the core
  use case.
- **Transcript mtime** — brushes the "no transcript access" constraint (§13),
  and goes stale during a long single tool. Rejected.
- **Tool-hook heartbeat + short configurable TTL** — chosen. Uses only stable,
  documented events; never false-cuts on CPU or network waits; touches no
  transcript content; adds no runtime deps; reuses the existing watchdog/TTL
  and suspend-style fade machinery.

Implementation:

- Register `PreToolUse` and `PostToolUse` (exec form, `heartbeat` arg, no
  matcher, `async: true`, `timeout: 5`). They map to a new fire-and-forget
  `heartbeat` control op that **touches** the session's `lastSeenAt` and clears
  its `idle` flag. Heartbeats never *create* a session — only an active turn's
  own tools reach them.
- New config `abandonedTurnSeconds` (default **90**, range 5 s…24 h). On each
  reconcile, a live (non-suspended) session whose `lastSeenAt` is older than
  this is flagged **`idle`**: it drops out of the playback refcount (fades out)
  but the record is kept so any later event resurrects it via `touch`. The
  10-minute stale TTL remains the eventual record GC.
- `idle` is independent of `paused`: `paused` is owned by the liveness watchdog
  (SIGSTOP), `idle` by the abandoned-turn timeout. Suspended sessions are
  skipped by the abandoned-turn pass so PC-207 resume semantics are unchanged.

Result: normal turns stop instantly on `Stop` (unchanged); agentic turns keep
purring because their tools heartbeat; an Esc-abandoned turn fades within
`abandonedTurnSeconds` instead of ~10 min.

**Accepted downside:** a turn that produces no tool events and no `Stop` for
longer than `abandonedTurnSeconds` (e.g. a very long pure-generation/thinking
turn) fades early. Mitigated by raising `abandonedTurnSeconds`; still bounded
and far better than the previous 10-minute floor.

## Consequences

- **Backlog / code:** new `heartbeat` op (`control/protocol.ts`, hook adapter,
  `Daemon`); `SessionRegistry.idle` + `setIdle`/`touch`; `reconcile`
  abandoned-turn pass; `abandonedTurnSeconds` config; `PreToolUse`/`PostToolUse`
  in the plugin `hooks.json` and the manifest validator (`hooksManifest.ts`).
- **PRD impact:** §8 "Interrupted session" acceptance should note the
  Esc-in-live-terminal case is covered by the abandoned-turn timeout (time-
  bounded), distinct from process-death (watchdog, ≤5 s). Follow-up PR.
- **Follow-ups:** re-check on future Claude Code versions if a real interrupt
  hook (#9516) ships — it would let us stop instantly and drop the heuristic.
  Verify heartbeat/idle behavior on macOS + Windows.
