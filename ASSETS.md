# ASSETS.md — bundled audio provenance ledger

Per-file license and source record for everything under `sounds/` (PRD §23.1 / FR-07).
Every change to `sounds/` must update this file in the same commit.

**Policy:** bundled audio must be original work, public domain, or **CC0** (PRD §23.4).
Attribution is not required for CC0; we still credit authors when they ask for courtesy credit.

---

## Credits (courtesy)

Additional sounds: **Joseph SARDIN** — [BigSoundBank.com](https://BigSoundBank.com)

Suggested site credit line:  
`Additional sounds: Joseph SARDIN - BigSoundBank.com`

---

## Ledger

| File | Preset | Format | Source | Author | License | Notes |
|---|---|---|---|---|---|---|
| `sounds/sleepy.ogg` | `sleepy` | Ogg Vorbis, mono, 48 kHz (~30 s loop) | [Cat Purring #3 (s1010)](https://bigsoundbank.com/cat-purring-3-s1010.html), trimmed for gapless loop | Joseph SARDIN (BigSoundBank.com) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) — see [BigSoundBank licenses](https://bigsoundbank.com/licenses.html) | Default MVP purr (FR-07). Loop cut 2026-07-22 (~30 s). |
| `sounds/sleepy.wav` | `sleepy` | PCM WAV, mono, 16-bit, 48 kHz (~30 s loop) | Same edit as `sleepy.ogg` | Joseph SARDIN (BigSoundBank.com) | CC0 1.0 | Canonical PCM twin; tier-3 / WAV-cache source (FR-08 / PC-304). |

### Source snapshot

- **Title:** Cat Purring #3  
- **Sound number:** 1010  
- **UCS:** Animals / Cat Domestic (`ANMLCat`)  
- **Equipment (per source page):** Tascam DR-40 + Sennheiser ME66  
- **Downloaded:** 2026-07-22 from BigSoundBank (WAV + OGG)  
- **Original filenames:** `ANMLCat_Cat purring 3 (ID 1010)_BigSoundBank.com.{ogg,wav}`  
- **Loop edit:** 2026-07-22 — trimmed to ~30 s seamless loop (maintainer), exported as mono OGG + WAV

### Licensing verification (human)

- [x] Confirmed sound page states **CC0 (public domain)**  
- [x] Confirmed [licenses page](https://bigsoundbank.com/licenses.html) allows share / adapt / commercial use without permission  
- [x] Confirmed attribution is **optional** (courtesy credit added above)  
- [x] Gapless loop edit landed  
- [ ] PC-309 listen pass (headphones/speakers)

---

## Not yet bundled (Phase 2 / E9)

| Preset | Status |
|---|---|
| `kitten` | Planned |
| `diesel` | Planned |
| `debugger` | Planned |
|