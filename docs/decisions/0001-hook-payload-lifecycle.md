# 0001 — Hook payload & lifecycle verification (Linux)

- **Status:** Accepted — Linux findings; macOS + Windows verification outstanding (flagged for PC-009)
- **Date:** 2026-07-18
- **Story:** PC-001
- **PRD refs:** §15 / §21 Q1, Q3 / §20 rows 1, 4 / RR-02

## Question

Do `UserPromptSubmit`, `Stop`, `StopFailure`, and `SessionEnd` behave as
documented on a current Claude Code release? Specifically: payload shapes,
`session_id` stability, whether Esc-interrupt fires `Stop` (§21 Q1),
whether `async: true` is truly non-blocking, the stakes of the fail-silent
invariant (stdout injection, error notices), the headless `-p` suppression
signal (§21 Q3), and the exact shipped hooks schema (§15).

## Evidence

Claude Code **v2.1.197** on Linux (Ubuntu, kernel 6.17.0-40), Node v20.20.2.
Turns were completed against a local SSE mock of the Messages API
(`ANTHROPIC_BASE_URL`), so no real account was involved; interactive scenarios
were driven through a PTY with scripted keystrokes. Raw captures, harness, and
a scenario index live in [`spikes/pc-001-hook-payload/`](../../spikes/pc-001-hook-payload/README.md).
**macOS and Windows were not available on the spike machine — nothing below is
verified there.**

1. **Events fire as documented (Linux).** Interactive normal turn fires
   `SessionStart` → `UserPromptSubmit` → `Stop` → `SessionEnd`. A failing turn
   (auth error) fires `StopFailure` (with `error` and `last_assistant_message`
   fields) instead of `Stop`. `StopFailure` is present in the shipped binary
   (17 string references), not just in docs.
2. **Payload shapes.** Every event carries `session_id`, `transcript_path`,
   `cwd`, `hook_event_name`. Additions: `UserPromptSubmit` → `prompt`,
   `prompt_id`, `permission_mode`; `Stop` → `prompt_id`, `stop_hook_active`,
   `last_assistant_message`, `effort`, `background_tasks`, `session_crons`;
   `SessionEnd` → `reason` (`"other"`, `"prompt_input_exit"` observed);
   `SessionStart` → `source` (`"startup"`), `model`.
3. **`session_id` is stable** within a session across all events (verified:
   one unique id across SessionStart/UserPromptSubmit/Stop/SessionEnd), and is
   also exported to the hook as `CLAUDE_CODE_SESSION_ID`.
4. **Esc-interrupt does NOT fire `Stop` on Linux** (§21 Q1). Mid-turn Esc shows
   "Interrupted" in the TUI; no `Stop`, no `StopFailure`. `SessionEnd` fires
   only when the session later exits. SIGKILL of the terminal/process emits
   nothing after `UserPromptSubmit`. The watchdog (RR-04) is therefore
   **essential, not defensive** — abandoned turns produce zero hook signal.
5. **`async: true` is non-blocking and detached.** With a `UserPromptSubmit`
   hook sleeping 10 s, the assistant reply rendered ~0.55 s after Enter; the
   hook process survived session exit and completed its full 10 s.
6. **Fail-silent stakes confirmed, with an async wrinkle.**
   - *Sync* hook stdout on `UserPromptSubmit` is injected verbatim into the
     next API request ("UserPromptSubmit hook success: <stdout>") — invisible
     in the TUI. *Async* hook stdout is discarded (not injected).
   - *Sync* hook exit 2 + stderr **blocks the prompt** and renders the stderr
     text in the transcript. *Async* hook exit 2 + stderr shows no visible
     notice on this version.
   - PurrCode ships `async: true`, which currently masks these failure modes,
     but the invariant (exit 0, no stdout/stderr, ever) stands: async-ness is a
     config value, and notice behavior is version-dependent.
7. **Headless `-p` mode** (§21 Q3): `SessionStart`, `UserPromptSubmit`,
   `SessionEnd` (and `StopFailure`) fire. **An async `Stop` hook never fires in
   `-p` mode** — the process exits first; a sync `Stop` hook does fire.
   `SessionEnd` fires promptly at process exit in all `-p` runs. Best
   suppression signal: `CLAUDE_CODE_ENTRYPOINT` env var — `"sdk-cli"` for `-p`
   runs vs `"cli"` interactive.
8. **Shipped hooks schema (§15).** Both the string `command` form and the exec
   form (`command` + `args` array) are accepted and fire; `timeout` and
   `async` are honored; `matcher` was omitted throughout with no warnings.
   Bonus for PC-002: with the **exec form the hook's parent process is the
   `claude` process itself**; with the string form it is an intermediate
   `/bin/sh -c` (grandparent is `claude`).

## Decision

- Keep the PRD §15 config exactly as drafted: **exec form + `async: true` +
  `timeout`**, no `matcher`. Verified working on the shipped version.
- Treat `UserPromptSubmit` = purr-start, `Stop`/`StopFailure` = purr-stop,
  `SessionEnd` = session cleanup, exactly as designed. Do **not** rely on any
  stop-ish event for interrupts or kills: the watchdog + TTL path (RR-04,
  PC-201…203) is the only stop signal for abandoned turns.
- In `-p` (headless) mode, do not expect `Stop` at all (async). Suppress via
  `CLAUDE_CODE_ENTRYPOINT === "sdk-cli"`, with `SessionEnd` as the safety net —
  it fires reliably at headless exit.
- The hook adapter (PC-107) may trust `session_id` (present everywhere,
  stable, duplicated in `CLAUDE_CODE_SESSION_ID`) as the registry key.
- Rejected alternative: sync hooks to gain `Stop`-in-`-p` and stderr
  diagnostics — unacceptable, a sync hook delays the prompt and its
  stdout/stderr leak into context/transcript (the exact P0 the invariant
  guards against).

## Consequences

- **Backlog impact (flag for PC-009):**
  - PC-002 can start: exec-form hooks give a direct `claude` parent PID on
    Linux — verify the same on macOS/Windows there.
  - PC-107 (hook adapter): add `-p`-mode suppression via
    `CLAUDE_CODE_ENTRYPOINT`; treat missing `Stop` as normal in headless runs.
  - PC-201/202 (watchdog): Esc-interrupt and kill produce **no** hook events on
    Linux — watchdog test emphasis stays as planned (PRD §20 row 1 confirmed).
  - PC-109/PC-206: add a headless-mode integration case (async `Stop` dropped).
- **PRD impact:** §21 Q1 answered ("no" on Linux); Q3 answered
  (`CLAUDE_CODE_ENTRYPOINT`). No amendment needed — the design already assumed
  the pessimistic answer.
- **Open follow-up:** repeat the matrix on macOS and Windows before PC-009
  go/no-go; the harness in `spikes/pc-001-hook-payload/` reruns it in minutes.
  Also re-check the async error-notice behavior on future Claude Code versions
  (currently silent; a regression to visible notices would surface any
  PurrCode crash).
