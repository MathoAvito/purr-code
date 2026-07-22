# 0004 — Tier-1 audio sidecar: miniaudio (C) selected

- **Status:** Accepted — amended PC-301 (production protocol, OGG via stb_vorbis, CI builds)
- **Date:** 2026-07-18 (macOS rerun 2026-07-19; PC-301 amendment 2026-07-22)
- **Story:** PC-004 / PC-301
- **macOS evidence:** [macos-rerun-20260719.md](../planning/reviews/macos-rerun-20260719.md) · `spikes/pc-004-audio-sidecar/evidence/macos-20260719/`
- **PRD refs:** §11.3 (tier-1 backend) / FR-07 / §20 rows 5, 10 / §12 (distribution)

## Question

miniaudio (C) or rodio (Rust) for the tier-1 sidecar? Must demonstrate:
gapless looping, runtime volume, fade ramps, a few-hundred-KB binary, a sane
cross-platform build story, and the esbuild-style `optionalDependencies`
distribution shape with no postinstall scripts.

## Evidence

Linux x64, gcc 15.2, miniaudio v0.11.25. PoC, seam checker, and raw evidence
in [`spikes/pc-004-audio-sidecar/`](../../spikes/pc-004-audio-sidecar/README.md).

1. **miniaudio PoC works end to end.** Single C file + single vendored
   header; builds with plain `cc -lm -lpthread -ldl` — *no audio dev packages*
   (backends are dlopen'd at runtime; the same binary picked PulseAudio on
   this desktop and the Null backend under `--null`). Stripped sizes: 655 KB
   with every decoder, **347 KB WAV-only** — inside the "few hundred KB"
   target.
2. **Gaplessness is sample-exact, not perceptual-only:** reading 6 file
   lengths through the looping data source in odd-sized chunks produced
   byte-identical iterations with zero short reads (`seam-check.json`).
   A 3.2 s null-backend run of a 1 s file wrapped 3× with continuous
   rendering.
3. **Runtime control proven** over the stdin line protocol: `VOLUME` moves
   are 100 ms gain ramps, `PLAY` fades in over 500 ms, `FADEOUT 400` ramped
   to silence and exited 395 ms after the command. All gain changes are
   per-sample ramps — no steps, hence no clicks by construction (audible QA
   remains PC-309).
4. **rodio comparison (documentation-based — no Rust toolchain on the spike
   machine):** requires `libasound2-dev` at build time on Linux even for
   PipeWire/PulseAudio output (cpal's base layer); typical minimal playback
   binaries land in the 1.5–3 MB range (Rust runtime + symphonia decoders);
   cross-compiling is documented but needs the pkg-config/sysroot dance for
   ALSA. Nothing disqualifying, but strictly more build friction and a larger
   floor than miniaudio for a sidecar this small.
5. **Distribution shape confirmed empirically:** an app with two
   `optionalDependencies` sidecar packages declaring `os`/`cpu` installed
   *only* the linux-x64 one on this machine (npm 10); `require.resolve` finds
   it; the win32 package is absent; no postinstall anywhere
   (`evidence/optionaldeps-filtering.txt`). The PC-008 placeholder packages
   already have the correct fields.

## Decision

- **miniaudio is the tier-1 sidecar.** Rationale: hits the size target with
  margin (347 KB vs a ~1.5 MB+ Rust floor), zero build-time audio
  dependencies on every platform (one `cc` invocation per CI runner — the
  PC-008 matrix already provides native macOS/Linux/Windows runners, so no
  cross-compilation is needed at all), dlopen'd backends degrade cleanly, and
  the null backend gives CI/agents a real playback path without hardware.
- **Control protocol: newline-delimited JSON on stdin, JSON events on stdout
  (not a socket).** Production (PC-301) replaced the PoC's text tokens with
  NDJSON so the Node adapter and C sidecar share one schema:
  `{"cmd":"load"|"play"|"volume"|"fadeout"|"quit"|"stats",...}`.
  **`volume` carries linear amplitude `[0,1]`** — the
  `SidecarAudioBackend` applies the PC-205 perceptual→amplitude map once;
  the sidecar never sees the 0–100 perceptual scale (avoids double-mapping).
  `fadeout` is non-blocking and emits `stopped` (process stays alive) so
  fade-cancel can resume; `quit` / stdin EOF still exit for orphan safety.
- **OGG (PC-301 decision): vendor `stb_vorbis`.** FR-07 keeps bundled
  OGG/WAV; PC-305 ships `sounds/sleepy.{ogg,wav}`; tier-1 plays the original
  (OGG preferred). Pin miniaudio **0.11.25** + its `extras/stb_vorbis.c`.
  Disable MP3/FLAC/generation. Linux x64 stripped size ≈ **557 KB** (under
  the soft 900 KB budget). WAV remains for FR-08 cache / tier-3.
  **Rejected for MVP:** WAV-only sidecar (would force FR-07 amendment and
  block OGG-as-primary).
- Rejected: rodio (build friction + size floor, no offsetting advantage
  here); shipping a socket protocol for the sidecar (needless surface when
  the daemon already owns the process); dynamic-link-time audio deps
  (miniaudio's dlopen approach avoids the packaging risk entirely).

## Consequences

- Backlog impact:
  - PC-301 ✅ production sidecar under `packages/sidecar/` + per-platform
    `optionalDependencies`; CI `sidecar-*` jobs build from source and publish
    `SHA256SUMS` artifacts (no postinstall).
  - PC-101 fake backend vocabulary extended with `stopped` / `error` / `stats`.
  - PC-205 applied inside `SidecarAudioBackend` (not the C binary).
  - PC-302+ detection consumes `SidecarAudioBackend.detect()`.
- PRD impact: none — FR-07 OGG/WAV retained; §11.3 tier-1 confirmed.
- macOS arm64 (2026-07-19 PoC): stripped **325 632 B** WAV-only; production
  binary grows with stb_vorbis (still a few hundred KB).
- Follow-ups: human audio QA of loop/fade quality at PC-309; npm publish of
  platform packages lands with Sprint 4 release pipeline (PC-407).
