# macOS platform rerun — handoff for a friend

**Goal:** close the Sprint 0 “Linux only” debt for macOS. Linux already answered the design questions; we need the **same answers on your Mac**, with evidence files we can attach to the ADRs.

**Time estimate:** ~2–3 hours if Node + Claude Code install cleanly.  
**Architecture:** Apple Silicon (arm64) preferred; Intel (x64) also useful if available.  
**Claude Code version:** record exact `claude --version` (Linux was 2.1.197 / 2.1.214).

Sprint 1 product work may already be underway on `main` — that is fine. This rerun is **async platform debt**; do not change product code unless a spike harness itself is broken on macOS (then fix only under `spikes/`).

---

## Copy-paste prompt for your coding agent

Clone the repo, open it in Cursor (or Claude Code), then paste this entire block:

```text
You are running the PurrCode macOS Sprint 0 platform rerun on this machine.

Read and follow: docs/planning/reviews/macos-platform-rerun.md

Your job:
1. Install prerequisites if missing (Node 20+, Claude Code CLI, Xcode CLT, pnpm).
2. From the repo root run: node spikes/rewrite-testbed-paths.cjs
3. Run every P0 scenario (PC-001, PC-002, PC-003, PC-006), then P1 if time (PC-004, PC-005).
4. Use the local mock API only — never a real Anthropic key:
     export ANTHROPIC_BASE_URL=http://127.0.0.1:41100
     export ANTHROPIC_API_KEY=pc001-mock
5. Save evidence under a folder like:
     macos-rerun-<hostname>-<YYYYMMDD>/NOTES.md
     macos-rerun-<hostname>-<YYYYMMDD>/pc-001/ …
6. In NOTES.md record: macOS version, chip (arm64/x64), `uname -m`, `claude --version`,
   `node -v`, and pass/fail for every checkbox in the doc.
7. Do not modify packages/, docs/decisions/, or product code unless a spike harness
   cannot run on macOS — then fix only under spikes/ and note it in NOTES.md.
8. When done, tell me the zip/folder path and a one-line summary per spike.

Stop and ask me only if: Claude Code interactive onboarding blocks you and you
cannot seed ~/.claude.json, or a P0 harness is fundamentally broken on this Mac.
```

---

## Prerequisites (once)

```bash
# Node 20+
node -v          # expect v20.x or newer

# Claude Code CLI
npm install -g @anthropic-ai/claude-code
claude --version

# Xcode CLT (for the audio sidecar C build)
xcode-select -p || xcode-select --install

# Clone + toolchain (collaborator with repo access)
git clone git@github.com:MathoAvito/purr-code.git
cd purr-code
git checkout main
corepack enable && corepack prepare pnpm@10.34.5 --activate
pnpm install

# REQUIRED: rewrite absolute Linux paths in spike settings to this clone
node spikes/rewrite-testbed-paths.cjs
```

**No Anthropic account needed** — local mock API only:

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:41100
export ANTHROPIC_API_KEY=pc001-mock
```

First interactive Claude run may show theme / “use this API key?” dialogs. Accept Dark + Yes for the mock key once (or seed `~/.claude.json` as in `spikes/pc-001-hook-payload/README.md`).

**Send back:** evidence files + `NOTES.md` (macOS version, chip, tool versions, pass/fail).

Suggested zip layout:

```text
macos-rerun-<hostname>-<date>/
  NOTES.md
  pc-001/
  pc-002/
  pc-003/
  pc-004/
  pc-005/
  pc-006/
```

---

## Priority map

| Priority | Spike | Why it matters on macOS |
|---|---|---|
| **P0 — must** | PC-001 hooks | Esc / kill / `-p` / async behavior may differ by OS/TTY |
| **P0 — must** | PC-002 PID + suspend | Uses `ps` not `/proc`; this is the watchdog foundation |
| **P0 — must** | PC-003 UDS + detach | Runtime dir on macOS is `$TMPDIR`, not `$XDG_RUNTIME_DIR` |
| **P0 — must** | PC-006 multi-session | Composed proof: refcount + kill ≤ 5 s |
| **P1 — should** | PC-004 sidecar build | CoreAudio path; binary size; gapless + fade |
| **P1 — should** | PC-005 plugin install | Confirms FR-01 on macOS plugin cache paths |
| **P2 — skip** | Windows named pipes | N/A on Mac |
| **P2 — skip** | Perceptual audio QA | Human Sprint 3 (PC-309), not this rerun |

---

## PC-001 — Hook payload & lifecycle (P0)

**Harness:** `spikes/pc-001-hook-payload/` (works on macOS; uses Python `pty`).

```bash
cd spikes/pc-001-hook-payload
node hooks/mock-anthropic.cjs &          # keep running; MOCK_DELAY_MS=20000 for Esc tests
export ANTHROPIC_BASE_URL=http://127.0.0.1:41100 ANTHROPIC_API_KEY=pc001-mock

# 1) Headless success (async Stop?)
rm -f evidence/hook-events.jsonl
(cd testbed && claude -p "Reply pong" < /dev/null)
# Save as evidence/macos-03-headless-success.jsonl

# 2) Exec-form parent is claude?
rm -f evidence/hook-events.jsonl
(cd testbed-execform && claude -p "Reply pong" < /dev/null)
# Inspect parentCmdline — expect "claude", not /bin/sh
# Save as evidence/macos-02-execform.jsonl

# 3) Interactive normal turn
python3 hooks/pty-drive.py macos-normal 45 \
  'w:shortcuts:20' 's:1' 'k:Reply pong' 's:1' 'e' 'w:pong:20' 's:2' 'k:/exit' 's:1' 'e'
# Expect events: SessionStart, UserPromptSubmit, Stop, SessionEnd; one session_id
# Save hook-events + tui-macos-normal.log

# 4) Esc mid-turn (slow mock)
kill %1 2>/dev/null; MOCK_DELAY_MS=20000 node hooks/mock-anthropic.cjs &
python3 hooks/pty-drive.py macos-esc 45 \
  'w:shortcuts:20' 's:1' 'k:Reply pong' 's:1' 'e' 'w:purr:20' 's:2' 'esc' 's:4' 'k:/exit' 's:1' 'e'
# PASS if: TUI shows Interrupted AND no Stop / StopFailure in hook-events
# Save as evidence/macos-06-esc-interrupt.jsonl

# 5) Kill mid-turn
python3 hooks/pty-drive.py macos-kill 40 \
  'w:shortcuts:20' 's:1' 'k:Reply pong' 's:1' 'e' 'w:purr:20' 's:2' 'sigkill'
# PASS if: nothing after UserPromptSubmit
```

**Pass criteria (must match Linux or note divergence):**

- [ ] `session_id` present and stable within a session  
- [ ] Exec-form: hook parent is `claude` (not a shell)  
- [ ] Esc → **no** `Stop` / `StopFailure`  
- [ ] SIGKILL → no stop hooks  
- [ ] Headless `-p`: record whether async `Stop` fires; note `CLAUDE_CODE_ENTRYPOINT` (`sdk-cli` vs `cli`)  
- [ ] Optional: slow async hook (10 s sleep) does not delay the reply  

**Known gotcha:** after PC-008, scripts are `.cjs` (not `.js`). Settings must point at `log-hook.cjs`. Paths must be rewritten via `node spikes/rewrite-testbed-paths.cjs`.

---

## PC-002 — PID capture & suspend (P0) — **macOS-adapted**

The Linux `probe.py` reads `/proc` and **will not work as-is**. On macOS, verify the same *questions* manually (or with a short script).

### A — Parent PID identity

1. Use PC-001 `testbed-execform` hooks (after path rewrite).  
2. Start mock API + interactive Claude in that directory.  
3. On `UserPromptSubmit`, the hook log records `ppid`.  
4. Compare to the Claude process: `pgrep -lf claude` or Activity Monitor.

**PASS:** hook `ppid` == Claude Code PID (exec form).  
**FAIL / note:** if hooks are reparented, record the ancestor chain (`ps -o pid,ppid,command -p <hook> -p <ppid> …`).

### B — Suspend detection (`ps`, not `/proc`)

In one terminal, start Claude (or any long-lived process) and note its PID.

```bash
# Poll every 2s (watchdog cadence)
while true; do date +%T; ps -o pid=,state=,lstart= -p <PID>; sleep 2; done
```

In another:

```bash
kill -STOP <PID>    # uncatchable suspend — expect state T (or TT)
# within ≤ 1–2 poll cycles, state must show stopped
kill -CONT <PID>    # expect running again (S/R)
```

Also try once:

```bash
kill -TSTP <PID>    # catchable; on Linux Claude swallows this — record macOS behavior
```

**PASS:**

- [ ] `STOP` → stopped state visible within one 2 s cycle  
- [ ] `CONT` → running again within one cycle  
- [ ] Record exact `ps -o state=` letters you see (document mapping for PC-201)  
- [ ] Note whether `TSTP` actually suspends Claude or is ignored  

### C — Identity / reuse

```bash
ps -o pid=,lstart= -p <PID>   # before STOP/CONT and after — lstart must be unchanged
# after kill:
ps -o pid=,lstart= -p <PID>   # must fail / empty
```

**PASS:** start time stable while alive; gone after death. (macOS has no `/proc` starttime field — `lstart` is the stand-in.)

---

## PC-003 — Control pipe / UDS (P0)

**Harness should run as-is** (Node `net` UDS). On macOS there is usually no `$XDG_RUNTIME_DIR`; the driver falls back to `os.tmpdir()`.

```bash
cd spikes/pc-003-control-pipe
node run-scenarios.mjs
# produces evidence/pc003-events.jsonl — copy to macos-pc003-events.jsonl
```

**PASS (same as Linux):**

- [ ] UDS echo works (any low ms RTT is fine)  
- [ ] Runtime dir mode `700`, socket `600`, per-UID naming  
- [ ] Detached daemon: own session, survives spawner exit (`survives_parent_exit: true`)  
- [ ] Cold-start connect-with-retry succeeds  
- [ ] Bind-as-mutex: second daemon `lost-race`  
- [ ] Stale socket reclaim after `SIGKILL` of owner  
- [ ] Idle-exit: stays alive while connection held, exits after close  

**Note divergences:** path under `/var/folders/...` is expected on macOS.

---

## PC-004 — miniaudio sidecar (P1)

```bash
cd spikes/pc-004-audio-sidecar
./fetch-vendor.sh
cc -Os -DMA_NO_MP3 -DMA_NO_FLAC -DMA_NO_GENERATION \
  -o purr-sidecar-min purr-sidecar.c -lm
# If link fails, try adding -lpthread; do not require -ldl on macOS
strip purr-sidecar-min
ls -la purr-sidecar-min          # record size (Linux was ~347KB)

cc -O2 -o seam-check seam-check.c -lm
./run-protocol.sh ./purr-sidecar-min   # null backend — no speakers needed
./seam-check test-purr.wav 6           # expect "gapless":true

# Optional real device (low volume):
( echo "LOAD test-purr.wav"; echo "VOLUME 15"; echo "PLAY"; sleep 2; echo "FADEOUT 400"; ) \
  | ./purr-sidecar-min
```

**PASS:**

- [ ] Builds on this Mac  
- [ ] `--null` protocol run: loop wraps + fadeout exits  
- [ ] `seam-check` → `gapless: true`  
- [ ] Real-device run picks CoreAudio (or similar) and exits cleanly  
- [ ] Record stripped binary size + `uname -m`  

---

## PC-005 — Plugin packaging (P1)

```bash
cd spikes/pc-005-plugin-packaging
# marketplace paths are relative — OK

claude plugin marketplace add "$(pwd)/marketplace"
claude plugin install purrcode-spike@purrcode-spike-marketplace

# Headless turn with mock API
node ../pc-001-hook-payload/hooks/mock-anthropic.cjs &
export ANTHROPIC_BASE_URL=http://127.0.0.1:41100 ANTHROPIC_API_KEY=pc001-mock
rm -f /tmp/pc005-hook-events.jsonl
(cd testbed && claude -p "Reply pong" < /dev/null)

# Inspect /tmp/pc005-hook-events.jsonl:
#  - CLAUDE_PLUGIN_ROOT set
#  - CLAUDE_PLUGIN_DATA set (path will be under ~/.claude/plugins/data/...)
#  - dataProbe.writes increments

# Update persistence (bump plugin.json version 0.0.1 → 0.0.2, then):
claude plugin marketplace update purrcode-spike-marketplace
claude plugin update purrcode-spike@purrcode-spike-marketplace
# Re-run -p; confirm marker firstWrittenAt unchanged, writes increased

# Enable/disable
claude plugin disable purrcode-spike@purrcode-spike-marketplace
# -p turn → zero new hook events
claude plugin enable purrcode-spike@purrcode-spike-marketplace
# -p turn → events resume

# Cleanup
claude plugin uninstall purrcode-spike@purrcode-spike-marketplace
claude plugin marketplace remove purrcode-spike-marketplace
```

**PASS:**

- [ ] Hooks fire via `${CLAUDE_PLUGIN_ROOT}`  
- [ ] Data persists across update  
- [ ] Disable → no hooks; enable → hooks again  

---

## PC-006 — Multi-session + kill (P0)

Watchdog uses `process-liveness.cjs` (Linux `/proc` or macOS `ps`). Paths must be rewritten first.

```bash
cd spikes/pc-006-multi-session
# confirm testbed/.claude/settings.json points at THIS clone (rewrite script)

MOCK_PORT=41166 MOCK_DELAY_MS=8000 node ../pc-001-hook-payload/hooks/mock-anthropic.cjs &
export ANTHROPIC_BASE_URL=http://127.0.0.1:41166 ANTHROPIC_API_KEY=pc001-mock
export PC006_SOCK=/tmp/pc006/purr.sock PC006_PLAYER_LOG=/tmp/pc006/player.jsonl

python3 two-sessions.py interleave 2 "1.k:purr one" "1.e" "s:3" "2.k:purr two" "2.e" "s:13" "1.q" "2.q" "s:11"
python3 two-sessions.py kill 1 "1.k:purr kill me" "1.e" "s:3" "1.sigkill" "s:15"
```

**PASS:**

- [ ] Interleave: exactly one player start; stop only when the **last** active session stops  
- [ ] Kill mid-turn: fade/stop within **≤ 5 s**, no orphaned player/daemon  
- [ ] Save `evidence/player-*.jsonl` and hook logs  

---

## What we will do with your results

1. Attach evidence under each `spikes/pc-00X-*/evidence/macos-*/`.  
2. Amend ADRs 0001–0006 status from “Linux only” → “Linux + macOS” (or document divergences).  
3. Update Sprint 0 review: macOS Phase 0 debt closed (Windows still separate).  
4. Any divergence (e.g. Esc *does* fire Stop on macOS) becomes a backlog amendment PR.

**Status (2026-07-19):** completed — see [macos-rerun-20260719.md](macos-rerun-20260719.md) and PR #11.

---

## Quick “done” definition

You’re done when you can send a zip that lets us tick:

1. Esc = no Stop (or documented opposite)  
2. Exec-form ppid = Claude  
3. `STOP`/`CONT` visible via `ps` within 2 s  
4. UDS daemon scenarios all green  
5. Two-session refcount + kill ≤ 5 s  
6. (Should) sidecar builds + gapless + fade  
7. (Should) plugin install/update/disable  

Windows remains a separate handoff; do not block on it.
