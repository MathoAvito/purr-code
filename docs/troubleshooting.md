# Troubleshooting

Short operational notes until the root `README.md` lands (Sprint 4 / PC-404). Also surfaced by `purrcode doctor`.

## Silent cat

1. Run `purrcode doctor` — every failed check prints a concrete fix.
2. Confirm volume: default **20** is very quiet (−48 dB linear). Try `purrcode volume 50` (or ~60).
3. Confirm hooks are not suppressed (`CI`, `CLAUDE_CODE_REMOTE`) and `disableAllHooks` is unset.
4. Confirm a backend is available: `purrcode status` → prefer **sidecar** (tier 1).

## Audio backend tiers

| Tier | Player | Loop | Fades | Runtime volume |
| --- | --- | --- | --- | --- |
| 1 (best) | Bundled `purr-sidecar` | Gapless | Yes | Yes |
| 2 | `mpv` on PATH | Gapless | Yes | Yes (mpv’s own curve) |
| 3 (degraded) | `afplay` / `paplay` / `aplay` / PowerShell | **Seamed** (respawn) | No (hard stop) | No |

**Tier-3 expectations (PC-309):** a brief click or gap at each loop wrap and an abrupt stop are normal. Prefer installing the sidecar (or mpv) for gapless looping and fades. Doctor warns when only native playback is available.

## Preview vs turn

- `purrcode preview` plays ~10 s at volume ≥ 50, then **hard-stops** (no fade). Useful for picking a sound.
- Real Claude turns use config fades and loop for the whole turn.
