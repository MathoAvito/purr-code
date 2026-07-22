# Sprint 3 review package — Real audio, CLI & doctor

**Branch:** `sprint-3-audio-cli`  
**PR:** [#19](https://github.com/MathoAvito/purr-code/pull/19)  
**Date prepared:** 2026-07-22  
**Goal (sprint file):** the cat becomes audible — tier-1 sidecar, honest degradation, MVP CLI (`on/off`, `status`, `volume`, `preview`, `doctor`).

**Status:** **Merged** to `main` 2026-07-22 ([PR #19](https://github.com/MathoAvito/purr-code/pull/19), merge `ceb00a9`). Sprint 4 may start. Windows spike debt remains unpaid (carry-forward from Sprint 0).

---

## Audit

| Check | Result |
|---|---|
| Board rows PC-301…PC-309 | ✅ in `START-HERE.md` (PC-309 with deferred OS listen noted) |
| Acceptance checkboxes in `sprint-3-audio-cli.md` | ✅ all ticked |
| In-sprint 🚧 human gates | PC-305 / PC-309 closed by human (2026-07-22) |
| Branch-per-sprint | ✅ one branch / one PR |

---

## Story table

| ID | Title | Pts | Status | Notes |
|---|---|---|---|---|
| PC-301 | Tier-1 sidecar: production build | 8 | ✅ | miniaudio + stb_vorbis; optionalDeps; CI artifacts |
| PC-302 | Tier detection & selection | 3 | ✅ | fake → sidecar → mpv → native → none |
| PC-303 | Tier-2 mpv adapter | 3 | ✅ | IPC volume; perceptual pass-through |
| PC-304 | Tier-3 + WAV cache | 5 | ✅ | seamed loop; always plays WAV |
| PC-305 | Default `sleepy` asset | 2 | ✅ | CC0 BigSoundBank #3; ~30 s loop; `ASSETS.md` |
| PC-306 | CLI: on/off, status, volume, preview | 5 | ✅ | preview ~10 s; volume floor 50 for preview |
| PC-307 | `purrcode doctor` | 3 | ✅ | FR-10 checks + exit codes |
| PC-308 | Failure-mode sweep | 1 | ✅ | fixtures + [pc-308 notes](pc-308-failure-mode-sweep.md) |
| PC-309 | Manual audio QA | — | ✅ | Linux headphones/speakers + loop wrap; see deviations |

**Total:** 30 pts story work complete on [#19](https://github.com/MathoAvito/purr-code/pull/19).

---

## Local proof (2026-07-22, Linux)

| Command | Result |
|---|---|
| `pnpm lint` | ✅ |
| `pnpm typecheck` | ✅ |
| `pnpm test` | ✅ 185 passed, 2 skipped |
| `pnpm e2e:fake-audio` | ✅ 11 passed |

### CI matrix (PR #19)

| Runner | Result |
|---|---|
| macos-latest | ✅ |
| ubuntu-latest | ✅ |
| windows-latest | ✅ |
| sidecar-linux-x64 / darwin-arm64 / darwin-x64 / win32-x64 | ✅ |

(Latest green run at review prep: `29950983804` on `b86ae92`+)

---

## Demo evidence (human + agent)

Sprint goal: *cat is audible; CLI works against live daemon.*

| Scenario | Evidence | Result |
|---|---|---|
| Sidecar build + preview | Human: `pnpm sidecar:build`; `preview sleepy` | ✅ audible after volume/preview fixes |
| Loop wrap (~30 s) | Human: 45 s preview via control `durationMs` | ✅ “sounds amazing” (gapless) |
| Headphones + speakers | Human listen | ✅ |
| Volume UX | Default 20 too quiet; human prefers **60** for turns | ✅ tip + preview floor ≥50 |
| Doctor / failure modes | `failure-mode-sweep.test.ts` + PC-308 notes | ✅ |
| Fake-audio e2e | `pnpm e2e:fake-audio` | ✅ |

---

## Decision records this sprint

| Item | Notes |
|---|---|
| ADR 0004 (sidecar) | Implemented; stb_vorbis for OGG (amendment path from PC-004 WAV-only PoC) |
| No new ADR files | Spike decisions from Sprint 0 consumed |

---

## Deviations / follow-ups

| Item | Severity | Proposed action |
|---|---|---|
| PC-309 macOS / Windows listen not run | Low | Carry-forward; Linux pass accepted for merge |
| Formal 15-minute fatigue listen not timed | Low | Human accepted via loop + multi-output listen; optional later |
| Live tier-3 subjective listen not run | Low | Expectations in [`docs/troubleshooting.md`](../../troubleshooting.md); doctor warns |
| Root `README.md` troubleshooting | — | Sprint 4 / PC-404 links to `docs/troubleshooting.md` |
| Product default volume still 20 | Product | Human uses 60 locally; keep subtle default unless product change requested |
| Windows spike rerun (Sprint 0 debt) | Medium | Still open; non-blocking for Sprint 3 merge |

---

## Open items for the human gate

- [x] PC-309 listen pass (Linux) — **accepted 2026-07-22**
- [x] **Merge [PR #19](https://github.com/MathoAvito/purr-code/pull/19)** — merged 2026-07-22 (`ceb00a9`)
- [ ] Optional carry-forward: macOS/Windows sleepy listen; timed 15-minute fatigue; tier-3 ear check
- [ ] Windows spike rerun (Sprint 0) — still unpaid

---

## Agent recommendation (pre-merge)

**Merge** — accepted. All Sprint 3 acceptance checkboxes were ticked; CI green on the full matrix including sidecar builds; human confirmed gapless loop and multi-output playback for `sleepy`. Remaining OS listen and Windows spike are documented carry-forwards.
