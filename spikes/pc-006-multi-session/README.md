# PC-006 — multi-session prototype (throwaway)

Two real Claude Code TUIs driven concurrently against a prototype
refcounting daemon. Findings: [ADR 0006](../../docs/decisions/0006-multi-session-refcounting.md).

- `proto-daemon.mjs` — UDS daemon: turn refcount, fake player (logged state
  transitions), 2 s watchdog with `(pid, starttime, state)` liveness, idle-exit.
- `hook-client.cjs` — exec-form hook target; maps events to daemon ops,
  spawns the daemon on demand, fail-silent.
- `testbed/.claude/settings.json` — exec-form async hook config.
- `two-sessions.py` — PTY driver for N concurrent sessions with interleaved
  keystrokes and a SIGKILL step.
- `evidence/` — player logs + hook invocation logs + raw TUI captures for the
  `interleave` and `kill` scenarios.

Rerun (needs the PC-001 mock API):

```sh
MOCK_PORT=41166 MOCK_DELAY_MS=8000 node ../pc-001-hook-payload/hooks/mock-anthropic.cjs &
export ANTHROPIC_BASE_URL=http://127.0.0.1:41166 ANTHROPIC_API_KEY=pc001-mock
export PC006_SOCK=/tmp/pc006/purr.sock PC006_PLAYER_LOG=/tmp/pc006/player.jsonl
python3 two-sessions.py interleave 2 "1.k:purr one" "1.e" "s:3" "2.k:purr two" "2.e" "s:13" "1.q" "2.q" "s:11"
python3 two-sessions.py kill 1 "1.k:purr kill me" "1.e" "s:3" "1.sigkill" "s:15"
```

Linux + macOS arm64 verified (2026-07-19). macOS uses `process-liveness.cjs`
(`ps` + `lstart` instead of `/proc`). Windows still unpaid.

macOS captures: `evidence/macos-20260719/`. On darwin, `two-sessions.py` sends
Esc once after ready to dismiss the welcome/tips panel (Linux unchanged).

Before running on a new clone, rewrite testbed paths:
`node spikes/rewrite-testbed-paths.cjs`.
