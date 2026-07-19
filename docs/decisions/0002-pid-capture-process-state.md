# 0002 — Claude PID capture & process-state detection (Linux + macOS)

- **Status:** Accepted — Linux + macOS arm64 verified (2026-07-19); Windows outstanding
- **Date:** 2026-07-18 (macOS rerun 2026-07-19)
- **Story:** PC-002
- **macOS evidence:** [macos-rerun-20260719.md](../planning/reviews/macos-rerun-20260719.md) · `spikes/pc-002-pid-process-state/evidence/macos-20260719/`
- **PRD refs:** §21 Q2 / §20 row 2 / RR-04 (watchdog)

## Question

Is the hook process's parent PID a reliable handle on the owning Claude Code
process (§21 Q2)? Can a watchdog polling at 2–5 s cadence detect a suspended
Claude and its resumption? Is PID reuse a real risk between watchdog cycles,
and is start-time verification needed?

## Evidence

Claude Code v2.1.197 on Linux (Ubuntu, kernel 6.17.0-40), Node v20.20.2. A
real `claude` TUI spawned in a PTY with the PC-001 exec-form hook settings and
mock API; probe and raw JSONL in
[`spikes/pc-002-pid-process-state/`](../../spikes/pc-002-pid-process-state/README.md).
**macOS arm64 verified 2026-07-19** via `ps -o state=,lstart=`: SIGSTOP → `T`
within ≤1 s, CONT → `S`, TSTP ignored (same as Linux), `lstart` identity OK.
**Windows still unpaid.**

1. **Parent PID identifies Claude Code (Linux + macOS).** With exec-form hooks
   (`command` + `args`, no shell), the hook's `process.ppid` equaled the
   spawned `claude` PID exactly (`scenario_a_parent_pid: match=true`). Hooks
   are direct children — no intermediate shell, no reparenting observed.
   With *string-form* hooks there is one `/bin/sh -c` in between (PC-001,
   ADR 0001 §Evidence 8) — another reason the plugin ships exec form.
2. **Ancestor-walk fallback works.** Walking `ppid`s from the live hook
   process reached `claude` in one step (`node → claude`); an unrelated
   control process never resolved to it. If a future version reparents hooks,
   the walk (bounded, name-matched) is the documented fallback. The
   `CLAUDE_CODE_SESSION_ID` env var also ties a hook to its session without
   any PID.
3. **Suspend detection at watchdog cadence (2 s polls):**
   - `SIGSTOP` → `/proc/<pid>/stat` state `T` detected on the **first** poll;
     `SIGCONT` → running again detected on the first poll.
   - **Claude Code handles `SIGTSTP`** (the Ctrl+Z signal): the process never
     entered `T`; it kept running. Likewise a raw `^Z` keypress is consumed by
     the raw-mode TUI and suspends nothing. The PRD §20 "Ctrl+Z → infinite
     purr" scenario is therefore *less likely* than assumed on Linux — but
     uncatchable `SIGSTOP` (and whatever macOS/Windows shells do) still
     produces real suspensions, so the state-aware watchdog stays.
4. **Identity token & PID reuse.** `(pid, starttime)` — `starttime` is field
   22 of `/proc/<pid>/stat`, in clock ticks since boot — was stable across
   suspend/resume and the whole session, and the stat read fails with ENOENT
   immediately after death (that failure *is* the liveness signal). Linux
   `pid_max` here is 4,194,304; recycling a specific PID within one 2–5 s
   watchdog cycle requires a full PID-space wraparound and is implausible —
   but the starttime check is one file read, so it is cheap insurance.

## Decision

- **PID capture:** the hook adapter (PC-107) records `process.ppid` at spawn
  and sends it to the daemon with the session registration. Exec-form hook
  config is a prerequisite (already decided, ADR 0001).
- **Identity:** the daemon stores `(pid, starttime)` at registration and
  re-verifies `starttime` on every watchdog read. A mismatch or ENOENT is
  treated as *process gone* → stop refcount for that session. Start-time
  verification is **adopted** (cheap, closes the reuse hole entirely).
- **Liveness/state read (Linux):** one read of `/proc/<pid>/stat`; state `T`
  = suspended (pause purr), ENOENT/mismatched starttime = dead. Detection
  within one watchdog cycle is proven.
- **macOS (verified 2026-07-19):** `ps -o state=,lstart= -p <pid>`; state
  letter `T` = suspended; identity token = `lstart` string. Extra letters
  `N` (nice) / `s` (session leader) observed — PC-201 should match on the
  primary letter.
- **Windows (unverified):** existence-only per PRD — no common suspend
  equivalent. Use Node's `process.kill(pid, 0)` (ESRCH ⇒ gone), which wraps
  `OpenProcess`; if start-time verification proves necessary there,
  `PROCESS_QUERY_LIMITED_INFORMATION` + `GetProcessTimes` is the API, but the
  10-min TTL (RR-05) is the primary backstop.
- Rejected alternative: identifying Claude by scanning the process table for
  `claude` command names — fragile (renames, multiple installs) and racy;
  the direct ppid handle is authoritative.

## Consequences

- Backlog impact (flag for PC-009):
  - PC-201 (liveness classification): adopt `(pid, starttime)` as the process
    identity; classify `running | suspended | gone`; Linux implementation is
    fully specified by this record.
  - PC-207 (suspend/resume turn-state): test with `SIGSTOP`/`SIGCONT`, not
    `SIGTSTP` — Claude Code swallows SIGTSTP, so tests using it would pass
    vacuously without exercising the suspend path.
  - PC-107 (hook adapter): include `ppid` + a fresh `starttime` read in the
    registration message.
- PRD impact: §21 Q2 answered (yes, with exec form, on Linux + macOS). §20 row 2
  nuance recorded (TUI swallows SIGTSTP); no amendment needed — the watchdog
  design already covers it.
- Follow-ups: Windows existence check still unpaid.
