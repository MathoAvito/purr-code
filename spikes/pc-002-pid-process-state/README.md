# PC-002 spike — Claude PID capture & process-state detection

Throwaway probe and evidence for PC-002. Findings and decisions live in
[docs/decisions/0002-pid-capture-process-state.md](../../docs/decisions/0002-pid-capture-process-state.md).

Tested: Claude Code v2.1.197, Linux (Ubuntu, kernel 6.17), Node v20.20.2;
v2.1.215, macOS arm64 (2026-07-19). Windows still unpaid (see ADR).

Linux: `evidence/pc002-events.jsonl`. macOS: `evidence/macos-20260719/`
(`ps -o state=,lstart=` instead of `/proc/<pid>/stat`).

## Harness

- `probe.py` — spawns a real `claude` TUI in a PTY (reusing the PC-001
  `testbed-execform` hook settings and mock API), then runs:
  - **A** parent-PID identity: the exec-form hook's `ppid` vs the spawned
    `claude` PID.
  - **B** suspend detection at 2 s watchdog cadence: raw `^Z` keypress,
    `SIGTSTP`, `SIGSTOP`, `SIGCONT`, polling `/proc/<pid>/stat` state.
  - **C** identity token: `(pid, starttime)` from `/proc/<pid>/stat` field 22 —
    stable across suspend/resume, unreadable (ENOENT) after death.
  - **D** ancestor-walk fallback from the live hook process, plus a control
    with an unrelated process.

Run with the PC-001 mock API up:

```bash
node ../pc-001-hook-payload/hooks/mock-anthropic.cjs &
python3 probe.py
```

## Evidence

`evidence/pc002-events.jsonl` — one JSONL record per observation, including
every watchdog poll with its observed `/proc` state.

Key rows: `scenario_a_parent_pid` (`match: true`),
`scenario_b2_sigtstp` (`suspended: false` — Claude Code handles SIGTSTP),
`scenario_b3_sigstop_detect` (`cycles: 1`), `scenario_b4_sigcont_detect`
(`cycles: 1`), `scenario_c_identity_stable` (`starttime_unchanged: true`),
`scenario_c_postmortem` (`stat_readable: false`).
