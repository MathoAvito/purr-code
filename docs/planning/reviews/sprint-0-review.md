# Sprint 0 review package — go/no-go (PC-009)

## Decision (signed)

**Go with platform-debt accepted** — 2026-07-19.

- Architecture unknowns that block Sprint 1 are resolved on **Linux** (ADRs 0001–0007).
- Phase 0 “prototype on macOS + Windows” is **not** fully closed; tracked as debt:
  - macOS: [macos-platform-rerun.md](macos-platform-rerun.md) / [PR #8](https://github.com/MathoAvito/purr-code/pull/8)
  - Windows: still unpaid (named-pipe elevated interop especially)
- Backlog reconciliation **approved and applied** to Sprint 1–4 story files in the same change set as this decision.
- PC-010 (reserve `purrcode` + LICENSE) remains a separate human gate — does not block Sprint 1.

Do **not** claim full Phase 0 / multi-OS MVP until the platform reruns land (target: before v0.1 / Sprint 3 audio QA).

---

## Story table

| ID | Title | Pts | Status | PR |
|---|---|---|---|---|
| PC-008 | Repo scaffolding & CI matrix | 5 | ✅ | [#2](https://github.com/MathoAvito/purr-code/pull/2) (merged) |
| PC-001 | Hook payload & lifecycle | 5 | ✅ Linux | [#1](https://github.com/MathoAvito/purr-code/pull/1) (merged) |
| PC-002 | Claude PID & process state | 3 | ✅ Linux | [#3](https://github.com/MathoAvito/purr-code/pull/3) (merged) |
| PC-003 | Control-pipe transport | 3 | ✅ Linux | [#4](https://github.com/MathoAvito/purr-code/pull/4) (merged) |
| PC-004 | Tier-1 audio sidecar | 5 | ✅ Linux PoC | [#5](https://github.com/MathoAvito/purr-code/pull/5) (merged) |
| PC-005 | Plugin packaging | 3 | ✅ Linux | [#5](https://github.com/MathoAvito/purr-code/pull/5) (merged) |
| PC-006 | Multi-session prototype | 2 | ✅ Linux | [#6](https://github.com/MathoAvito/purr-code/pull/6) (merged) |
| PC-007 | Name & trademark | 1 | ✅ recommend | [#7](https://github.com/MathoAvito/purr-code/pull/7) (merged) |
| PC-009 | Go/no-go & backlog reconciliation | 1 | ✅ go + debt | *this document* |
| PC-010 | Reserve package name & repo | 1 | 🚧 | human — confirm `purrcode` |

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

## Phase 0 exit criteria (§19)

| Criterion | Status |
|---|---|
| No orphaned player after stop / interrupt / kill | ✅ Linux (PC-006); macOS/Windows unpaid |
| Multi-session refcounting correct | ✅ Linux (PC-006) |
| Prototype on macOS, Linux, and Windows | ⛔ Linux only — **accepted debt** |
| §21 Q1–Q3, Q5 answered | ✅ Linux; Q4 WSL deferred Phase 2 |
| Tier-1 sidecar selected | ✅ miniaudio (PC-004); macOS/Windows builds unpaid |
| Plugin path viable | ✅ Linux (PC-005) |

## Backlog reconciliation (applied)

| Finding | Stories updated |
|---|---|
| Esc/kill fire no Stop — watchdog primary | PC-109, PC-201/202 |
| Claude handles SIGTSTP — test with SIGSTOP | PC-207 |
| Async Stop flaky in `-p` — use `CLAUDE_CODE_ENTRYPOINT` | PC-107, PC-109 |
| Exec-form mandatory for ppid / refcount | PC-107, PC-401 |
| Identity `(pid, starttime)`; `Z`/`X` = dead | PC-201 |
| Windows elevated pipes unknown — fallback out of MVP | PC-103 |
| miniaudio + stdin protocol; OGG TBD | PC-301, PC-101 |
| Uninstall deletes plugin data unless `--keep-data` | PC-403 |

**PRD amendments:** none filed for go. Optional later: footnote §21 Q1/Q3/Q5 resolved-on-Linux.

## Platform debt (open)

1. macOS friend checklist — [macos-platform-rerun.md](macos-platform-rerun.md)
2. Windows named-pipe + elevated interop — still need a machine
3. Do not claim multi-OS MVP until (1)+(2) evidence is folded into ADRs
