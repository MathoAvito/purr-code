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
| `sounds/sleepy.ogg` | `sleepy` | Ogg Vorbis, mono, 48 kHz (~91 s) | [Cat Purring #3 (s1010)](https://bigsoundbank.com/cat-purring-3-s1010.html) | Joseph SARDIN (BigSoundBank.com) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) — see [BigSoundBank licenses](https://bigsoundbank.com/licenses.html) | Default MVP purr (FR-07). Gapless loop cut still pending (PC-305 / PC-309). |
| `sounds/sleepy.wav` | `sleepy` | PCM WAV, mono, 16-bit, 48 kHz (~91 s) | Same as `sleepy.ogg` | Joseph SARDIN (BigSoundBank.com) | CC0 1.0 | Canonical PCM twin of the OGG; used as reference / tier-3 WAV-cache source until install-time transcode lands (FR-08 / PC-304). |

### Source snapshot

- **Title:** Cat Purring #3  
- **Sound number:** 1010  
- **UCS:** Animals / Cat Domestic (`ANMLCat`)  
- **Equipment (per source page):** Tascam DR-40 + Sennheiser ME66  
- **Downloaded:** 2026-07-22 from BigSoundBank (WAV + OGG)  
- **Original filenames:** `ANMLCat_Cat purring 3 (ID 1010)_BigSoundBank.com.{ogg,wav}`

### Licensing verification (human)

- [x] Confirmed sound page states **CC0 (public domain)**  
- [x] Confirmed [licenses page](https://bigsoundbank.com/licenses.html) allows share / adapt / commercial use without permission  
- [x] Confirmed attribution is **optional** (courtesy credit added above)  
- [ ] Gapless loop edit + PC-309 listen pass (headphones/speakers)

---

## Not yet bundled (Phase 2 / E9)

| Preset | Status |
|---|---|
| `kitten` | Planned |
| `diesel` | Planned |
| `debugger` | Planned |
