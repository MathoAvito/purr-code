# Sprint 0 review package — go/no-go (PC-009)

Prepared for the human gate. **Do not start Sprint 1 until this review is signed off** and any backlog amendments below are applied (or explicitly deferred).

## Story table

| ID | Title | Pts | Status | PR |
|---|---|---|---|---|
| PC-008 | Repo scaffolding & CI matrix | 5 | ✅ | [#2](https://github.com/MathoAvito/purr-code/pull/2) (merged) |
| PC-001 | Hook payload & lifecycle | 5 | ✅ Linux | [#1](https://github.com/MathoAvito/purr-code/pull/1) (merged) |
| PC-002 | Claude PID & process state | 3 | ✅ Linux | [#3](https://github.com/MathoAvito/purr-code/pull/3) (merged) |
| PC-003 | Control-pipe transport | 3 | ✅ Linux | [#4](https://github.com/MathoAvito/purr-code/pull/4) (merged) |
| PC-004 | Tier-1 audio sidecar | 5 | ✅ Linux PoC | [#5](https://github.com/MathoAvito/purr-code/pull/5) |
| PC-005 | Plugin packaging | 3 | ✅ Linux | [#5](https://github.com/MathoAvito/purr-code/pull/5) (bundled) |
| PC-006 | Multi-session prototype | 2 | ✅ Linux | [#6](https://github.com/MathoAvito/purr-code/pull/6) |
| PC-007 | Name & trademark | 1 | ✅ recommend | [#7](https://github.com/MathoAvito/purr-code/pull/7) |
| PC-009 | Go/no-go & backlog reconciliation | 1 | 🚧 | *this document* |
| PC-010 | Reserve package name & repo | 1 | 🚧 | after PC-007 decision |

**Merge before signing go:** PRs #5, #6, #7 (board rows for 004–007 only fully sync after merge).

## Decision records

| ADR | Topic | Verdict |
|---|---|---|
| [0001](../../decisions/0001-hook-payload-lifecycle.md) | Hook payload & lifecycle | Esc/kill fire **no** Stop; async Stop dropped in `-p`; fail-silent stakes confirmed |
| [0002](../../decisions/0002-pid-capture-process-state.md) | PID & process state | Exec-form ppid = claude; `(pid,starttime)` identity; SIGTSTP swallowed |
| [0003](../../decisions/0003-control-pipe-transport.md) | Control pipe | UDS + bind-mutex + idle-pin proven; Windows TCP fallback **defer MVP** |
| [0004](../../decisions/0004-audio-sidecar-selection.md) | Audio sidecar | **miniaudio** selected; stdin protocol; 347 KB PoC |
| [0005](../../decisions/0005-plugin-packaging.md) | Plugin packaging | FR-01 viable; enable/disable = on/off; uninstall deletes data by default |
| [0006](../../decisions/0006-multi-session-refcounting.md) | Multi-session | Refcount correct; kill → fade ≤5 s; treat zombie `Z` as dead |
| [0007](../../decisions/0007-package-name.md) | Name | Recommend **`purrcode` / PurrCode**; confirm at PC-010 |

## Phase 0 exit criteria (§19) — checklist for human

- [ ] No orphaned player after normal stop, interrupt, or terminal kill — **Linux prototype yes** (PC-006); macOS/Windows unpaid
- [ ] Multi-session refcounting correct — **Linux yes** (PC-006)
- [ ] Prototype passes on macOS, Linux, and Windows — **Linux only**; matrix unpaid (see below)
- [ ] Open questions §21 Q1–Q3, Q5 answered with evidence — **yes on Linux**; Q4 (WSL) deferred Phase 2 as PRD leans
- [ ] Tier-1 sidecar selected with gapless + fade demo — **miniaudio**, Linux PoC (PC-004)
- [ ] Plugin path viable — **yes** (PC-005)

## Platform debt (must schedule before claiming “3 OS”)

All spikes except scaffolding were verified on **Linux only**. Recommended: one workflow-dispatch job on `macos-latest` + `windows-latest` reusing `spikes/pc-001`…`pc-006` harnesses (no Docker-OSX). Until that runs, ADRs stay “Accepted — Linux; other platforms outstanding.”

## Backlog reconciliation (apply only after human approval)

Findings that change later stories — proposed edits, **not applied**:

| Finding | Affected stories | Proposed change |
|---|---|---|
| Esc/kill fire no Stop | PC-201/202/207, PC-109 | Keep watchdog as primary; emphasize Esc/kill cases in tests |
| Claude handles SIGTSTP | PC-207 | Tests must use `SIGSTOP`/`SIGCONT`, not Ctrl+Z |
| Async Stop flaky in `-p` | PC-107, PC-109 | Suppress via `CLAUDE_CODE_ENTRYPOINT=sdk-cli`; rely on `SessionEnd` |
| Exec-form mandatory for ppid | PC-107, PC-401 | Never ship string-form hooks |
| Identity = `(pid, starttime)`; treat `Z` as dead | PC-201 | Encode in liveness classifier |
| Windows named-pipe elevated interop unknown | PC-103 | Fallback out of MVP; fail-silent OK |
| miniaudio + stdin protocol | PC-301, PC-101 | Port PoC protocol; OGG = stb_vorbis or WAV-only |
| Uninstall deletes plugin data | PC-403 | Document `--keep-data`; user state in own config dir |
| Name `purrcode` | PC-010 | Publish placeholder when human confirms |

**PRD amendments:** none required for go — design assumed the pessimistic answers. Optional: footnote §21 Q1/Q3/Q5 as resolved-on-Linux; §20 row 2 nuance (SIGTSTP).

## Demo evidence (agent-verifiable)

```bash
pnpm lint && pnpm typecheck && pnpm test   # green after PC-008
# Spike demos (Linux):
#   spikes/pc-001…006 READMEs + evidence/
# e2e:fake-audio — not yet (PC-101/109); N/A for Sprint 0
```

CI matrix (lint/typecheck/test) green on macOS/Ubuntu/Windows for scaffolding PRs.

## Human gate checklist (PC-009 + PC-010)

### PC-009 — go/no-go

- [ ] Merge open PRs #5, #6, #7
- [ ] Read ADRs 0001–0007
- [ ] Decide: **go** / **go with platform-debt accepted** / **no-go**
- [ ] Approve or reject backlog reconciliation table above; if approve, agent applies edits to Sprint 1–4 files in a follow-up PR
- [ ] Optional: schedule macOS/Windows harness rerun before claiming Phase 0 fully closed

### PC-010 — reserve name (after go)

- [ ] Confirm final npm name (`purrcode` recommended)
- [ ] `npm publish` placeholder (or reserve) + MIT `LICENSE` if not already
- [ ] Confirm GitHub visibility/org (keep `MathoAvito/purr-code` or rename/org)

---

**Agent stop.** No Sprint 1 stories started. No gate items marked ✅.
