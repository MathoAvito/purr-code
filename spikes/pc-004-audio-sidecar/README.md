# PC-004 spike — tier-1 audio sidecar selection

Proof-of-concept and evidence for PC-004. Findings and decisions live in
[docs/decisions/0004-audio-sidecar-selection.md](../../docs/decisions/0004-audio-sidecar-selection.md).

Tested: Linux x64 (Ubuntu, kernel 6.17), gcc 15.2, miniaudio **v0.11.25**;
macOS arm64 built locally (2026-07-19). Windows build still unpaid (PC-301).
rodio was compared on documentation only (no Rust toolchain on this machine).

## Files

- `purr-sidecar.c` — PoC sidecar: stdin line protocol (`LOAD` / `PLAY` /
  `VOLUME 0-100` / `FADEOUT ms` / `STATS` / `QUIT`), JSON events on stdout,
  gapless looping via `ma_data_source_set_looping`, per-sample gain ramps for
  fade-in/out and volume moves, `--null` flag for the no-sound-card backend,
  exits on stdin EOF (orphan safety).
- `seam-check.c` — decodes N loops through the same looping data source in
  odd-sized chunks and byte-compares every iteration against the first.
- `fetch-vendor.sh` — pulls the pinned miniaudio header (4 MB, not committed).
- `run-protocol.sh` — regenerates the test WAV and drives the full protocol
  on the null backend.

Build: `cc -O2 -o purr-sidecar purr-sidecar.c -lm -lpthread -ldl` — no audio
dev packages needed (miniaudio dlopens ALSA/PulseAudio/CoreAudio/WASAPI at
runtime).

## Results (Linux x64)

| Measure | Result |
|---|---|
| Binary size, stripped, all decoders | 655 KB |
| Binary size, stripped, WAV-only (`MA_NO_MP3/FLAC/GENERATION`) | **347 KB** |
| Gaplessness (seam-check, 5 loop comparisons) | byte-identical, 0 short reads |
| Loop wraps in a 3.2 s null-backend run (1 s file) | 3 (continuous render) |
| `FADEOUT 400` → process exit | 395 ms |
| Real-device run (PulseAudio picked at runtime) | ready → loop → fade → exit 0 |
| optionalDependencies filtering (npm 10) | only the os/cpu-matching package installs |

Perceptual claims (seam audibility, pop-free fades) are **not** made here —
that is PC-309 human QA. What is proven is sample-exact loop wrap and ramped
(never stepped) gain changes.

## Results (macOS arm64)

Evidence: `evidence/macos-20260719/` (logs/JSONL only — no Mach-O binary committed).

| Measure | Result |
|---|---|
| Binary size, stripped, WAV-only | **325 632 B** (~318 KiB); no `-ldl` on link line |
| Gaplessness (`seam-check`) | `gapless: true` |
| Null-backend protocol | loop wraps + fadeout → exiting |
| Real-device run | Core Audio backend, clean exit |
