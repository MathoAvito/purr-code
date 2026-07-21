# START HERE — How to run this backlog

This file answers one question: **"what do I work on right now?"** Keep it open; the progress board at the bottom is the single source of truth for status. Update it as stories move — it's the living kanban for this repo.

---

## The operating rhythm

Yes — the work is "just" per sprint and per story, in order, but with three rules that make it safe to hand stories to agents:

1. **Work stories in board order, one at a time.** Within a sprint, stories are already sequenced by dependency (e.g. PC-103 transport before PC-104 daemon). Don't start a story whose dependencies aren't ✅. Parallelize only where the board's "depends on" column shows no overlap.
2. **A story is done when its checkboxes are done.** Every story in the sprint files is a checklist. The agent (or you) implements, writes the tests named in the story, ticks the boxes in the sprint file, and updates the board here. Spikes additionally produce a decision record in `docs/decisions/`.
3. **Never cross a gate without the human review.** Sprint boundaries and 🚧 human-gate stories (go/no-go, licensing, audio QA, GitHub settings, release) are where *you* stop and review. Everything between gates can run agent-autonomously.

### Per-story loop

The repo ships agent workflows as project skills (in `.cursor/skills/`, mirrored for Claude Code in `.claude/skills/`), so in Cursor or Claude Code you can just say:

- **"Implement PC-XYZ"** (or "next story") → `implement-story` skill: qualifies dependencies, implements to the acceptance checkboxes, verifies, ticks boxes, updates this board.
- **"Run spike PC-00X"** → `run-spike` skill: timeboxed investigation producing a decision record in `docs/decisions/`.
- **"Close sprint N"** → `sprint-review` skill: assembles the review package for the human gate.

Repo-wide agent context (architecture, commands, hard constraints) lives in `AGENTS.md`; `CLAUDE.md` points there. For agents without skill support, paste: *"Read `AGENTS.md`, then `docs/planning/sprint-N-*.md` story PC-XYZ and the PRD sections it references. Implement it to its acceptance checkboxes including the tests it names. When done: tick the checkboxes, update the board in `docs/planning/START-HERE.md`, and push to the sprint branch / sprint PR."*

### Per-sprint loop

1. Sprint start: create (or check out) the sprint branch `sprint-N-<short-slug>` off up-to-date `main`, open/update the sprint PR, skim the sprint file's goal + demo line so you know what "done" looks like.
2. Run stories per the board — all on that one branch; commits reference `PC-XYZ`.
3. Sprint end: run the demo described at the top of the sprint file, review the human-gate items, merge the sprint PR, then move to the next sprint file.
4. After Sprint 0 only: run the PC-009 go/no-go and **amend the later sprint files** where spike findings contradict PRD assumptions, before anything from Sprint 1 starts. *(Done 2026-07-19 — go + platform debt.)*

## What to start right now

**Sprint 0 closed:** go with platform-debt accepted ([reviews/sprint-0-review.md](reviews/sprint-0-review.md)).  
**Sprint 1 closed:** walking skeleton merged ([PR #15](https://github.com/MathoAvito/purr-code/pull/15)).

- **Sprint 2 review package ready** — [reviews/sprint-2-review.md](reviews/sprint-2-review.md) · [PR #17](https://github.com/MathoAvito/purr-code/pull/17). Human: merge when CI matrix is green; do not start Sprint 3 until accepted.
- **Still open (human):** **Windows** spike rerun (macOS closed — [macos-rerun-20260719.md](reviews/macos-rerun-20260719.md)).

---

## Progress board

Status legend: ⬜ todo · 🔵 in progress · ✅ done · ⛔ blocked · 🚧 human gate

### Sprint 0 — Spikes & scaffolding ([sprint-0-spikes.md](sprint-0-spikes.md))

| Story | Title | Pts | Depends on | Status |
|---|---|---|---|---|
| PC-008 | Repo scaffolding & CI matrix | 5 | — | ✅ |
| PC-001 | Spike: hook payload & lifecycle | 5 | — | ✅ Linux + macOS (Win owed) |
| PC-002 | Spike: Claude PID & process state | 3 | PC-001 | ✅ Linux + macOS (Win owed) |
| PC-003 | Spike: control-pipe transport | 3 | — | ✅ Linux + macOS UDS (Win owed) |
| PC-004 | Spike: tier-1 audio sidecar | 5 | — | ✅ miniaudio Linux + macOS arm64 (Win owed) |
| PC-005 | Spike: plugin packaging | 3 | PC-001 | ✅ Linux + macOS (Win owed) |
| PC-006 | Spike: multi-session prototype | 2 | PC-001, PC-003 | ✅ Linux + macOS (Win owed) |
| PC-007 | Spike: name & trademark check | 1 | — | ✅ |
| PC-009 | Go/no-go & backlog reconciliation | 1 | all spikes | ✅ go + platform debt |
| PC-010 | Reserve package name & repo | 1 | PC-007 | ✅ npm `purr-code` + MIT LICENSE |

### Sprint 1 — Walking skeleton ([sprint-1-walking-skeleton.md](sprint-1-walking-skeleton.md))

| Story | Title | Pts | Depends on | Status |
|---|---|---|---|---|
| PC-101 | Fake audio backend | 3 | PC-008 | ✅ |
| PC-102 | Runtime directory (hardened) | 2 | PC-008 | ✅ |
| PC-103 | Control pipe & message protocol | 5 | PC-003, PC-102 | ✅ |
| PC-104 | Daemon core: lifecycle, races | 5 | PC-103 | ✅ |
| PC-105 | Session registry & state machine | 5 | PC-104, PC-101 | ✅ |
| PC-106 | Snapshot & corruption recovery | 2 | PC-105 | ✅ |
| PC-107 | Hook adapter | 5 | PC-001, PC-002, PC-104 | ✅ |
| PC-108 | Debug logging | 2 | PC-107 | ✅ |
| PC-109 | Integration suite v1 | 3 | PC-105–107 | ✅ |

### Sprint 2 — Reliability ([sprint-2-reliability.md](sprint-2-reliability.md))

| Story | Title | Pts | Depends on | Status |
|---|---|---|---|---|
| PC-201 | Process liveness classification | 5 | PC-002 | ✅ |
| PC-202 | Watchdog loop | 5 | PC-201, PC-105 | ✅ |
| PC-203 | Stale TTL & reconciliation | 3 | PC-202 | ✅ |
| PC-204 | Configuration store & schema | 3 | PC-008 | ✅ |
| PC-205 | Perceptual volume model | 3 | PC-101 | ✅ |
| PC-206 | Failure-injection & chaos pass | 5 | PC-109, PC-202 | ✅ |
| PC-207 | Suspend/resume turn-state | 3 | PC-202 | ✅ |

### Sprint 3 — Real audio, CLI & doctor ([sprint-3-audio-cli.md](sprint-3-audio-cli.md))

| Story | Title | Pts | Depends on | Status |
|---|---|---|---|---|
| PC-301 | Tier-1 sidecar: production build | 8 | PC-004, PC-205 | ⬜ |
| PC-302 | Tier detection & selection | 3 | PC-301 | ⬜ |
| PC-303 | Tier-2 mpv adapter | 3 | PC-302 | ⬜ |
| PC-304 | Tier-3 adapter + WAV cache | 5 | PC-302 | ⬜ |
| PC-305 | Default `sleepy` purr asset | 2 | — | 🚧 |
| PC-306 | CLI: on/off, status, volume, preview | 5 | PC-204, PC-302 | ⬜ |
| PC-307 | `purrcode doctor` | 3 | PC-306 | ⬜ |
| PC-308 | Failure-mode sweep | 1 | PC-307 | ⬜ |
| PC-309 | Manual audio QA | — | PC-301, PC-305 | 🚧 |

### Sprint 4 — Packaging, OSS & release ([sprint-4-packaging-release.md](sprint-4-packaging-release.md))

| Story | Title | Pts | Depends on | Status |
|---|---|---|---|---|
| PC-401 | Plugin package | 5 | PC-005, PC-301–307 | ⬜ |
| PC-402 | `npx purr-code install` | 5 | PC-401 | ⬜ |
| PC-403 | `purrcode uninstall` | 3 | PC-402 | ⬜ |
| PC-404 | Community health files | 3 | — | ⬜ |
| PC-405 | AGENTS.md + CLAUDE.md | 2 | PC-404 | ⬜ |
| PC-406 | CI security hardening & DCO | 3 | PC-008 | 🚧 |
| PC-407 | Release pipeline (Changesets) | 3 | PC-406 | ⬜ |
| PC-408 | Definition-of-Done audit | 3 | everything | 🚧 |
| PC-409 | v0.1.0 release | 1 | PC-408 | 🚧 |

---

After v0.1.0 ships: run the MVP retro, then break epics E9–E12 ([01-epics.md](01-epics.md)) into Sprint 5+ story files the same way.
