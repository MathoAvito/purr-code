# PC-408 — §22 Definition-of-Done audit (human gate)

Agents prepare this checklist; a human walks fresh machines and signs licensing.

## Fresh-machine matrix

For each OS (macOS, Ubuntu, Windows):

| # | Check | Evidence |
|---|---|---|
| 1 | One-command install (`npx purr-code install` or local `purrcode install`) | |
| 2 | `settings.json` hooks untouched (marketplace keys may appear — no hook surgery) | |
| 3 | Prompt → purr → stop → silence within watchdog bounds | |
| 4 | Failure / abandoned session / suspend-resume behave per FR | |
| 5 | Zero transcript artifacts (no hook error notices) | |
| 6 | Two-session correctness | |
| 7 | No orphaned audio after tested failure modes | |
| 8 | Config survives install/remove (`--keep-data` path) | |
| 9 | No transcript/prompt data read or stored | |
| 10 | Bundled-audio rights verified (human; `ASSETS.md`) | |
| 11 | CI matrix green including fake-audio | |
| 12 | Community files + DCO + fork-PR rules in place | |

Gaps → blocking bugs → re-run after fixes. Do not mark PC-408 ✅ until every row passes on all three OSes (or accepted debt is documented).

## Agent pre-evidence (Linux, 2026-07-22)

- `pnpm lint && pnpm typecheck && pnpm test && pnpm e2e:fake-audio` green locally
- `pnpm plugin:build` + `claude plugin validate` OK
- `purrcode install` / idempotent re-run / `purrcode uninstall` smoke on Linux
- Headless Claude turn after plugin install: stdout `ok`, no hook-error transcript noise
- Community files (PC-404) + AGENTS.md (PC-405) landed
- Workflow lint bans `pull_request_target`; DCO + Changeset CI present (require-on-`main` still human)
