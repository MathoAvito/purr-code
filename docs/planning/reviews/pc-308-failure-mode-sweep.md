# PC-308 — Failure-mode sweep (§20 × doctor)

- **Date:** 2026-07-22
- **Branch:** `sprint-3-audio-cli`
- **Scope:** operational risks reachable at Sprint 3 (pre-plugin packaging)

## Automated (CI / fixture)

| §20 risk (reachable now) | Doctor check | Evidence |
|---|---|---|
| Hook command fails to resolve | `hook-resolution` | `packages/cli/test/failure-mode-sweep.test.ts` |
| Missing audio backend | `backend` | same + `doctor.test.ts` |
| Unowned / insecure runtime dir | `runtime-dir` | same + symlink fixture in `doctor.test.ts` |
| Suspended owner (Ctrl+Z) | `daemon` warn (`paused sessions`) | `failure-mode-sweep.test.ts` |
| `disableAllHooks` silent disable | `disableAllHooks` | `doctor.test.ts` / sweep |
| CI / remote suppression | `suppression` warn | `doctor.test.ts` |
| Tier-3 degradation honesty | `backend` warn on native | unit path via capabilities |

## Not induced here (documented gaps — not blocking PC-308 close)

| Item | Why | Follow-up |
|---|---|---|
| Esc/interrupt with no Stop | Watchdog/TTL path; not a doctor surface | Covered by PC-202/203 tests |
| Windows named-pipe ACL blocks | Windows spike unpaid | Human Windows rerun |
| Plugin hook path `${CLAUDE_PLUGIN_ROOT}` live resolve | Needs installed Claude plugin (PC-401/402) | Manual after packaging |
| Real SIGSTOP → doctor while Claude TUI suspended | Needs interactive Claude | Human: stop Claude with Ctrl+Z, run `purrcode doctor`, expect paused warn |
| Installer damages settings | Installer not shipped yet | PC-402/403 |
| Perceptual audio / loop seam | Human gate PC-305/309 | Do not claim |

## Manual checklist (human, optional for this sprint)

1. `PURRCODE_FAKE_AUDIO=` unset, no sidecar/mpv → `purrcode doctor` reports backend fail or native warn.
2. `chmod`/`chown` a bad runtime dir → doctor fails `runtime-dir`.
3. Ctrl+Z a live Claude turn → doctor warns paused sessions; `fg` clears it.
4. Set `"disableAllHooks": true` in `~/.claude/settings.json` → doctor fails with fix text.
