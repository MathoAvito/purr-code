# Sprint 2 review package — Reliability & Reconciliation

**Branch:** `sprint-2-reliability`  
**PR:** [#17](https://github.com/MathoAvito/purr-code/pull/17)  
**Date prepared:** 2026-07-22  
**Goal (sprint file):** close the abandoned-turn gap (§7). Esc, terminal kill, suspend, daemon restart — none leave a purring orphan. RR-01…RR-05 covered via fake-audio suite.

**Agent recommendation:** **Merge when CI matrix is green** (see CI note below). No in-sprint 🚧 human-gate stories. Do **not** start Sprint 3 until this package is accepted. Windows spike debt remains unpaid (carry-forward from Sprint 0).

---

## Audit

| Check | Result |
|---|---|
| Board rows PC-201…PC-207 | ✅ all ✅ in `START-HERE.md` |
| Acceptance checkboxes in `sprint-2-reliability.md` | ✅ all ticked |
| In-sprint 🚧 human gates | none |
| Branch-per-sprint | ✅ one branch / one PR for the sprint |

---

## Story table

| ID | Title | Pts | Status | Notes |
|---|---|---|---|---|
| PC-201 | Process liveness classification | 5 | ✅ | `(pid, starttime)`; Linux `Z`/`X` = dead; macOS `ps`; Win existence-only |
| PC-202 | Watchdog loop | 5 | ✅ | 2 s cadence; kill→fade ≤5 s with **zero** Stop events |
| PC-203 | Stale TTL & reconciliation | 3 | ✅ | 10 m TTL; reconcile on every message + tick + boot |
| PC-204 | Configuration store & schema | 3 | ✅ | FR-06 defaults + `schemaVersion`; atomic write; live `set-config` |
| PC-205 | Perceptual volume model | 3 | ✅ | `gain_dB = −60 + 0.6·v`; adapter contract (fake/mpv pass-through) |
| PC-206 | Failure-injection & chaos | 5 | ✅ | Hook fail-silent; daemon play-throw / crash-respawn / stress |
| PC-207 | Suspend/resume turn-state | 3 | ✅ | SIGSTOP/SIGCONT only; stop-while-paused → no resume |

**Total:** 27 pts — all non-gate stories complete on [#17](https://github.com/MathoAvito/purr-code/pull/17).

---

## Local proof (2026-07-22, Linux)

| Command | Result |
|---|---|
| `pnpm lint` | ✅ |
| `pnpm typecheck` | ✅ |
| `pnpm test` | ✅ 121 passed, 1 skipped (Windows-only case) |
| `pnpm e2e:fake-audio` | ✅ 11 passed |

### CI matrix (PR #17)

Status at review prep (run after PC-207 push; **before** CI flake fixes in this review commit):

| Runner | Result | Notes |
|---|---|---|
| macos-latest | ✅ pass | |
| ubuntu-latest | ❌ fail | Flake: `SIGSTOP` → classify raced `/proc` (`running` vs `suspended`) |
| windows-latest | ❌ fail | Tests forced `platform: "linux"` on Daemon → UDS `.sock` bind `EACCES` |

**Follow-up in this review commit:** poll after SIGSTOP in `process-liveness.test.ts`; remove Daemon `platform: "linux"` overrides that break Windows named-pipe isolation. **Human: wait for the post-fix CI run to go green before merge.**

---

## Demo evidence (sprint review scenario)

Sprint file demo: *kill mid-turn → fade ≤ 5 s; SIGSTOP → pause; SIGCONT → resume.*

Executed via focused suite (fake backend, real child processes as Claude stand-ins):

```text
pnpm vitest run packages/cli/test/watchdog.test.ts packages/cli/test/suspend-resume.test.ts --reporter=verbose
```

| Scenario | Test | Result |
|---|---|---|
| Owner kill, **zero** stop/failure events → fade ≤ 5 s | `watchdog`: owner-kill with zero stop events… | ✅ (~150 ms locally) |
| SIGSTOP → pause within one cycle → SIGCONT → resume | `watchdog` + `suspend-resume`: resume with turn open | ✅ |
| One suspended + one running keeps purring | `watchdog`: one suspended + one running… | ✅ |
| Suspend → **stop** → CONT → **no** playback | `suspend-resume`: suspend → stop arrives → resume → no playback | ✅ |
| TTL continues during pause | `suspend-resume`: TTL continues during suspension… | ✅ |

Primary abandoned-turn path (ADR 0001 / PC-009): watchdog is the cleanup mechanism when Esc/kill fire no Stop — covered by kill-with-zero-stop and inject-classifier tests.

---

## Decision records this sprint

No new ADRs. Sprint 2 **implements** Sprint 0 decisions:

| ADR | Used by |
|---|---|
| 0001 (no Stop on Esc/kill) | PC-202 / PC-206 / PC-207 tests |
| 0002 (`(pid,starttime)`, SIGSTOP not SIGTSTP) | PC-201 / PC-207 |
| 0006 (`Z`/`X` = dead; 2 s cadence) | PC-201 / PC-202 |

**PC-207 TTL-during-suspend:** kept counting (no ADR; spike evidence did not suggest freezing TTL).

---

## Deviations / follow-ups

| Item | Severity | Proposed action |
|---|---|---|
| CI flake / Windows UDS misuse in tests | Fixed in this review commit | Confirm matrix green on [#17](https://github.com/MathoAvito/purr-code/pull/17) |
| Windows spike rerun still unpaid | Carry-forward | Complete before claiming full multi-OS MVP / before Sprint 3 audio QA if possible |
| Amplitude conversion in real adapters | Expected | Sprint 3 PC-301/304 exercise `perceptualToLinearAmplitude` |
| Perceptual audio QA (seams, pops, fatigue) | Human-only | Sprint 3 PC-309 — not claimed here |

No unticked acceptance checkboxes. No scope drift into PRD §5 non-goals.

---

## Human gate checklist

- [ ] Read this package + skim [#17](https://github.com/MathoAvito/purr-code/pull/17) diff
- [ ] Confirm **CI green** on ubuntu-latest + macos-latest + windows-latest after the review/CI-fix commit
- [ ] Spot-check demo criteria (or trust agent evidence above): kill→fade ≤5 s; SIGSTOP pause; SIGCONT resume
- [ ] Decide: **merge Sprint 2** into `main`?
- [ ] Acknowledge carry-forward: **Windows spike rerun** still open (not a Sprint 2 story, but platform debt)
- [ ] Do **not** start Sprint 3 until merge/go is recorded
- [ ] Optional: run `sprint-review` follow-up / retro notes after merge

---

## Recommendation

**Go / merge Sprint 2** once the CI matrix is green on the review-fix commit.

Rationale: all 27 pts of acceptance criteria are implemented and locally verified; abandoned-turn (RR-04) and fail-open (RR-02) paths are demonstrated with fake audio; no in-sprint human-gate stories remain. Blocking only on CI confirmation after the known Ubuntu/Windows test fixes land.
