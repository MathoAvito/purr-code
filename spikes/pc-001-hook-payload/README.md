# PC-001 spike — hook payload & lifecycle verification

Throwaway harness and captured evidence for the PC-001 spike. **Never import
anything here from product code.** Findings and decisions live in
[docs/decisions/0001-hook-payload-lifecycle.md](../../docs/decisions/0001-hook-payload-lifecycle.md).

Tested: Claude Code **v2.1.197**, Linux (Ubuntu, kernel 6.17), Node v20.20.2.
macOS and Windows were **not** available; those runs are still owed (see ADR).

## Harness

- `hooks/log-hook.js` — logging hook registered for every event; appends one
  JSONL record per invocation (raw stdin payload, pid/ppid/parent cmdline,
  `CLAUDE_*` env, timings). Env toggles: `PC001_SLEEP_MS`, `PC001_EXIT_CODE`,
  `PC001_STDOUT`, `PC001_STDERR`, `PC001_TARGET` (limit toggles to one event).
- `hooks/mock-anthropic.js` — minimal SSE mock of the Messages API so turns
  complete without a real account (`ANTHROPIC_BASE_URL=http://127.0.0.1:41100
  ANTHROPIC_API_KEY=pc001-mock`). `MOCK_DELAY_MS` stretches the stream so an
  interactive Esc can land mid-turn. Logs request bodies (redacted post-run to
  marker proof only) to `evidence/api-requests.jsonl`.
- `hooks/pty-drive.py` — drives the interactive TUI through a PTY with scripted
  keystrokes (type, Enter, Esc, SIGKILL); captures TUI output to
  `evidence/tui-<scenario>.log`. `PC001_TESTBED` selects the settings variant.
- `hooks/drive-interactive.sh` — first attempt with `script(1)`; superseded by
  `pty-drive.py` (kept for reference).
- `testbed/` — string-form `command` hooks, `async: true`, all five events.
- `testbed-execform/` — exec-form `command`+`args` hooks, `async: true`.
- `testbed-sync/` — exec-form hooks without `async` (blocking).

## Evidence index

| File | Scenario | Key finding |
|---|---|---|
| `01-headless-noauth-baseline.jsonl` | `claude -p` while logged out | `SessionStart`/`UserPromptSubmit`/`StopFailure`/`SessionEnd` fire; `StopFailure` carries `error: authentication_failed` |
| `02-execform-schema.jsonl` | exec-form settings, `-p` | `command`+`args` accepted; hook's parent is `claude` itself (no `/bin/sh`) |
| `03-headless-success-turn.jsonl` | `-p` against mock API | successful turn; **async `Stop` never fires in `-p`**, `SessionEnd` does (reconfirmed with `--debug hooks`, capture not kept) |
| `05-interactive-normal-turn.jsonl` | TUI normal turn | all four events fire; `session_id` identical across all |
| `06-esc-interrupt.jsonl` | TUI, Esc mid-turn | turn interrupted (TUI shows "Interrupted"); **no `Stop`, no `StopFailure`** |
| `07-terminal-kill.jsonl` | TUI, SIGKILL mid-turn | nothing after `UserPromptSubmit` — no stop signal of any kind |
| `08-slow-async-hook.jsonl` | 10 s sleeping async hook | reply rendered ~0.55 s after Enter; hook outlived the session and finished at 10 s |
| `09-headless-sync-stop.jsonl` | sync hooks, `-p` | sync `Stop` **does** fire in `-p` mode |
| `api-requests.jsonl` | stdout-injection runs | sync `UserPromptSubmit` stdout injected into the API request as "UserPromptSubmit hook success: …"; async stdout never injected |
| `tui-exit2-sync.log` | sync hook exit 2 + stderr | stderr text rendered in the transcript, prompt **blocked** |
| `tui-exit2-async.log` | async hook exit 2 + stderr | no visible notice anywhere |

## Rerunning

```bash
node hooks/mock-anthropic.js &                      # or MOCK_DELAY_MS=20000 for interrupt tests
export ANTHROPIC_BASE_URL=http://127.0.0.1:41100 ANTHROPIC_API_KEY=pc001-mock
cd testbed && claude -p "Reply pong"                # headless
python3 hooks/pty-drive.py normal-turn 45 'w:shortcuts:15' 's:1' 'k:Reply pong' 's:1' 'e' 'w:pong:15' 's:2' 'k:/exit' 's:1' 'e'
```

First run on a fresh machine needs onboarding pre-seeded in `~/.claude.json`
(`hasCompletedOnboarding`, `theme`, `customApiKeyResponses.approved`) or the
TUI stops at the theme/login wizard.
