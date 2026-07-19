# macOS Sprint 0 platform rerun

Evidence from Idan’s Mac (2026-07-19). Harness fixes landed in the same PR
(`sess=` on darwin in PC-003; Esc-to-dismiss tips in PC-006). Binary sidecar
artifact and duplicate zip were dropped — keep logs/JSONL only.

Per-spike evidence lives under `spikes/pc-00X-*/evidence/macos-20260719/`.

## Machine

- hostname: Idans-MacBook-Pro-2.local
- date: 2026-07-19T18:06:08Z (UTC) / evidence collected ~21:06–21:17 local
- macOS: 26.5.1 (25F80)
- chip / `uname -m`: arm64 (Apple Silicon)
- node: v22.23.1
- claude: 2.1.215 (Claude Code)
- pnpm: 10.34.5
- python3: 3.14.5 (also saw 3.13 via conda earlier in session)
- xcode-select: `/Library/Developer/CommandLineTools`
- mock API only: `ANTHROPIC_BASE_URL=http://127.0.0.1:41100` / `41166`, `ANTHROPIC_API_KEY=pc001-mock`

## Prerequisites installed this run

- `brew install node@22` → v22.23.1
- `corepack prepare pnpm@10.34.5`
- `npm install -g @anthropic-ai/claude-code` → 2.1.215
- Xcode CLT already present
- `node spikes/rewrite-testbed-paths.cjs` (rewrote 4 settings files to this clone)
- Seeded `~/.claude.json`: `hasCompletedOnboarding`, `theme`, mock key approved, `hasTrustDialogAccepted` for spike testbed paths

## Harness fixes under `spikes/` (macOS-only)

1. **`spikes/pc-003-control-pipe/run-scenarios.mjs`** — Linux `ps -o sid=` is invalid on BSD/macOS; use `sess=` on darwin. Functional detach still proven via `survives_parent_exit: true`. Note: macOS often reports `sess=0` for both processes, so `newSession` boolean may be false even when detach works.
2. **`spikes/pc-006-multi-session/two-sessions.py`** — after `wait_ready`, send Esc once to dismiss Claude Code welcome/tips panel so scripted keystrokes reach the prompt.

No changes under `packages/`, `docs/decisions/`, or product runtime.

---

## Checkbox results (from `docs/planning/reviews/macos-platform-rerun.md`)

### PC-001 — Hook payload & lifecycle (P0)

| Criterion | Result | Notes |
|---|---|---|
| `session_id` present and stable within a session | **PASS** | Interactive normal: single `56327a54-…` across SessionStart/UPS/Stop/SessionEnd |
| Exec-form: hook parent is `claude` (not a shell) | **PASS** | `parentCmdline: "claude"` / `"claude -p Reply pong"`; interactive `ppid == CLAUDE_PID` |
| Esc → **no** `Stop` / `StopFailure` | **PASS** | TUI shows Interrupted; events: SessionStart, UserPromptSubmit, SessionEnd only |
| SIGKILL → no stop hooks | **PASS** | Events stop after UserPromptSubmit |
| Headless `-p`: async `Stop`? + `CLAUDE_CODE_ENTRYPOINT` | **PASS (matches Linux)** | Async Stop **does not** fire; `CLAUDE_CODE_ENTRYPOINT=sdk-cli`. Interactive uses `cli`. |
| Optional: slow async hook (10 s) does not delay reply | **PASS** | `pong` found ~0.2 s after Enter; `PC001_SLEEP_MS=10000` observed on UPS |

Evidence: `spikes/pc-001-hook-payload/evidence/macos-20260719/`

### PC-002 — PID + suspend (P0)

| Criterion | Result | Notes |
|---|---|---|
| Hook `ppid` == Claude PID (exec form) | **PASS** | `ppid=22430`, `CLAUDE_PID=22430`, `parentCmdline=claude` |
| `STOP` → stopped within one 2 s cycle | **PASS** | State `RNs`/`SNs` → `TNs` within ≤1 s (`suspend-poll-ps.log`) |
| `CONT` → running again within one cycle | **PASS** | `TNs` → `SNs` within ≤1 s |
| Record exact `ps -o state=` letters | **PASS** | See mapping below |
| Note whether `TSTP` suspends Claude | **PASS (ignored)** | State stayed `SNs` after `kill -TSTP` (same as Linux: Claude swallows TSTP) |
| `lstart` stable while alive; gone after death | **PASS** | `lstart` unchanged across STOP/CONT; after SIGKILL briefly `Z` then absent |

**macOS `ps -o state=` mapping observed (for PC-201):**

| Letter | Meaning here |
|---|---|
| `R` | running |
| `S` | sleeping / interruptible wait |
| `T` | stopped (SIGSTOP) |
| `Z` | zombie |
| `N` | nice (low priority) |
| `s` | session leader |

Evidence: `spikes/pc-002-pid-process-state/evidence/macos-20260719/`

### PC-003 — Control pipe / UDS (P0)

| Criterion | Result | Notes |
|---|---|---|
| UDS echo works | **PASS** | p50 RTT 0.028 ms (n=50) |
| Runtime dir mode `700`, socket `600`, per-UID naming | **PASS** | Under `$TMPDIR` → `/var/folders/.../T/purrcode-spike-501` |
| Detached daemon: own session, survives spawner exit | **PASS*** | `survives_parent_exit: true`. `*ps sess=` reported `0`/`0` so `newSession` flag false — document as macOS `ps` quirk; detach still works |
| Cold-start connect-with-retry | **PASS** | 4 attempts / 79 ms |
| Bind-as-mutex: second daemon `lost-race` | **PASS** | |
| Stale socket reclaim after SIGKILL | **PASS** | |
| Idle-exit: alive while held, exits after close | **PASS** | exited ~1500 ms after close |

Evidence: `spikes/pc-003-control-pipe/evidence/macos-20260719/`

### PC-004 — miniaudio sidecar (P1)

| Criterion | Result | Notes |
|---|---|---|
| Builds on this Mac | **PASS** | no `-ldl`; strip OK |
| `--null` protocol: loop wraps + fadeout exits | **PASS** | `loopWraps:4`, fadeout → exiting |
| `seam-check` → `gapless: true` | **PASS** | |
| Real-device: CoreAudio + clean exit | **PASS** | `"backend":"Core Audio"` |
| Record stripped size + `uname -m` | **PASS** | **325632 bytes** (~318 KiB), **arm64** (Linux was ~347 KiB) |

Evidence: `spikes/pc-004-audio-sidecar/evidence/macos-20260719/` (logs/JSONL only; no Mach-O binary)

### PC-005 — Plugin packaging (P1)

| Criterion | Result | Notes |
|---|---|---|
| Hooks fire via `${CLAUDE_PLUGIN_ROOT}` | **PASS** | `CLAUDE_PLUGIN_ROOT` + `CLAUDE_PLUGIN_DATA` set (`~/.claude/plugins/data/...`) |
| Data persists across update | **PASS** | `firstWrittenAt` unchanged `2026-07-19T18:14:55.409Z`; writes 1 → 4+ |
| Disable → no hooks; enable → hooks again | **PASS** | disabled: zero events; re-enabled: UPS+SessionEnd |

Cleanup: plugin uninstalled + marketplace removed. Evidence: `spikes/pc-005-plugin-packaging/evidence/macos-20260719/`

### PC-006 — Multi-session + kill (P0)

| Criterion | Result | Notes |
|---|---|---|
| Interleave: exactly one player start; stop only when last active session/turn stops | **PASS** | One `player:start`; fade/stop after second `turn-stop` (refcount) |
| Kill mid-turn: fade/stop ≤ 5 s, no orphan | **PASS** | `watchdog-evict` on state `Z` ~0.7 s after SIGKILL; `daemon-idle-exit`; no lingering `proto-daemon` |
| Save player + hook / TUI logs | **PASS** | `pc-006/player-*.jsonl`, traces, TUI logs |

Evidence: `spikes/pc-006-multi-session/evidence/macos-20260719/`

---

## Quick “done” definition (doc §)

1. Esc = no Stop — **PASS**
2. Exec-form ppid = Claude — **PASS**
3. STOP/CONT visible via `ps` within 2 s — **PASS**
4. UDS daemon scenarios all green — **PASS** (with `sess=` / `newSession` note)
5. Two-session refcount + kill ≤ 5 s — **PASS**
6. Sidecar builds + gapless + fade — **PASS**
7. Plugin install/update/disable — **PASS**

## One-line summaries

- **PC-001:** Matches Linux lifecycle (Esc/kill/async Stop gap); entrypoint `sdk-cli` headless / `cli` TUI.
- **PC-002:** Exec-form ppid=Claude; SIGSTOP→`T` / CONT→`S` within 1 s; TSTP ignored; `lstart` identity OK.
- **PC-003:** All UDS scenarios green under `$TMPDIR`; need `ps -o sess=` (not `sid=`); detach proven by orphan survival.
- **PC-004:** Builds arm64 (326 KB stripped); null + Core Audio; `gapless:true`.
- **PC-005:** Plugin install/update/disable/enable works; data dir persists across update.
- **PC-006:** Refcount + macOS `ps` watchdog OK; kill→fade ≈1 s; zombie (`Z`) treated as dead.
