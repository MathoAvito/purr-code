# Sprint 4 review package — Packaging, OSS surface & v0.1.0

**Branch:** `sprint-4-packaging-release`  
**PR:** [#21](https://github.com/MathoAvito/purr-code/pull/21)  
**Date prepared:** 2026-07-22  
**Goal (sprint file):** ship — plugin install/uninstall, §22 DoD audit, v0.1.0 on npm with provenance.

**Status:** Agent-completable stories done; **blocked on human gates** PC-406 / PC-408 / PC-409. Do not tag or publish until those close.

---

## Audit

| Check | Result |
|---|---|
| Board rows PC-401…PC-405, PC-407 | ✅ (PC-401/402 note Linux smoke; macOS/Win E2E human) |
| PC-406 | 🚧 workflows ready; human applies GitHub settings |
| PC-408 / PC-409 | 🚧 human |
| Acceptance checkboxes | Agent boxes ticked; multi-OS E2E + DoD + release left open |
| Branch-per-sprint | ✅ one branch / one PR |

---

## Story table

| ID | Title | Pts | Status | Notes |
|---|---|---|---|---|
| PC-401 | Plugin package | 5 | ✅ | `packages/plugin/`; §15 exec-form hooks; Linux validate+install smoke |
| PC-402 | `npx purr-code install` | 5 | ✅ | Mocked registration tests + Linux real install |
| PC-403 | `purrcode uninstall` | 3 | ✅ | `--keep-data` / `--purge`; install→uninstall clean |
| PC-404 | Community health files | 3 | ✅ | README, CONTRIBUTING, CoC, SECURITY, templates, CODEOWNERS |
| PC-405 | AGENTS.md + CLAUDE.md | 2 | ✅ | Architecture map; fresh-agent friction pass |
| PC-406 | CI security hardening & DCO | 3 | 🚧 | See [pc-406-human-gate.md](pc-406-human-gate.md) |
| PC-407 | Release pipeline (Changesets) | 3 | ✅ | Tag-only `release.yml`; human env/Trusted Publisher still owed |
| PC-408 | Definition-of-Done audit | 3 | 🚧 | See [pc-408-dod-audit.md](pc-408-dod-audit.md) |
| PC-409 | v0.1.0 release | 1 | 🚧 | See [pc-407-pc-409-human-notes.md](pc-407-pc-409-human-notes.md) |

---

## Local proof (2026-07-22, Linux)

| Command | Result |
|---|---|
| `pnpm lint` | ✅ |
| `pnpm typecheck` | ✅ |
| `pnpm test` | ✅ 203 passed, 2 skipped |
| `pnpm e2e:fake-audio` | ✅ 11 passed |
| `pnpm plugin:build` | ✅ `claude plugin validate` OK |
| `bash scripts/ci/lint-workflows.sh` | ✅ |

### Demo (agent, Linux)

| Scenario | Result |
|---|---|
| `purrcode install` | Detected Claude 2.1.x; marketplace + plugin; sleepy WAV cache; tier sidecar |
| Idempotent re-install | “already installed”; no duplicate |
| Headless `claude -p` after install | stdout `ok`; no hook-error transcript noise |
| `purrcode uninstall` | Plugin + marketplace + runtime cleared; second run “already clean” |

---

## Decision records this sprint

None new (reused ADR 0005 for packaging).

---

## Deviations / carry-forwards

| Item | Notes |
|---|---|
| PC-401 multi-OS Claude E2E | Linux only; macOS/Windows + perceptual prompt→purr→stop still human |
| PC-402 multi-OS manual | Same |
| Windows spike debt | Still unpaid (Sprint 0) |
| DCO on this PR | Commits lack `Signed-off-by:` — human must re-sign (`git rebase` + `-s`) or DCO CI will fail once required |
| Marketplace → `settings.json` | Claude writes `extraKnownMarketplaces` / `enabledPlugins`; **hooks** still never written (FR-01 intent) |

---

## Human gate checklist

### PC-406 — repo settings ([detail](pc-406-human-gate.md))

- [ ] Branch protection on `main` (required CI + DCO + workflow-lint, review, squash, linear history)
- [ ] Secret scanning (+ push protection)
- [ ] Mark DCO check required after first green run
- [ ] Re-sign sprint commits with DCO if this PR must pass DCO CI before merge

### PC-408 — §22 DoD ([detail](pc-408-dod-audit.md))

- [ ] Walk matrix on macOS / Ubuntu / Windows fresh machines
- [ ] Licensing sign-off on bundled audio

### PC-409 — v0.1.0 ([detail](pc-407-pc-409-human-notes.md))

- [ ] Create GitHub Environment `release` + npm Trusted Publisher
- [ ] `pnpm version-packages` → tag `v0.1.0` on `main` → verify Release workflow
- [ ] Post-release `npx purr-code install` smoke per OS
- [ ] Schedule MVP retro + Phase 2 breakdown (E9–E11)

---

## Stop

Agent work for Sprint 4 is paused at human gates. Do not merge as “v0.1.0 shipped” until PC-408/409 close. PR [#21](https://github.com/MathoAvito/purr-code/pull/21) remains the sprint vehicle.
