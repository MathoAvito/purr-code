# 0004 — Tier-1 audio sidecar: miniaudio (C) selected

- **Status:** Accepted — Linux x64 + macOS arm64 PoCs built; Windows build unpaid (PC-301)
- **Date:** 2026-07-18 (macOS rerun 2026-07-19)
- **Story:** PC-004
- **macOS evidence:** [macos-rerun-20260719.md](../planning/reviews/macos-rerun-20260719.md) · `spikes/pc-004-audio-sidecar/evidence/macos-20260719/`
- **PRD refs:** §11.3 (tier-1 backend) / §20 rows 5, 10 / §12 (distribution)

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
- **Control protocol: stdin line protocol, not a socket.** Commands
  `LOAD <path>` / `PLAY` / `VOLUME <0-100>` (perceptual; cubic amplitude map
  as placeholder until PC-205) / `FADEOUT <ms>` / `QUIT`; JSON events on
  stdout. The daemon owns the pipe: no naming, no permissions surface, and
  stdin EOF doubles as orphan cleanup — the sidecar exits when its daemon
  dies. (Verified: PoC exits on EOF.)
- **OGG note for PC-301:** miniaudio decodes WAV/FLAC/MP3 natively but *not*
  Vorbis; OGG support means vendoring `stb_vorbis.c` (~single file, ~+100 KB)
  or shipping WAV-only assets for MVP. Decide in PC-301 with the PC-305 asset
  format; either fits the size budget.
- Rejected: rodio (build friction + size floor, no offsetting advantage
  here); shipping a socket protocol for the sidecar (needless surface when
  the daemon already owns the process); dynamic-link-time audio deps
  (miniaudio's dlopen approach avoids the packaging risk entirely).

## Consequences

- Backlog impact (flag for PC-009):
  - PC-301 (production sidecar): port the PoC's protocol and looping/ramp
    structure; add stb_vorbis or WAV-only decision; build in CI natively per
    platform (macos arm64 + x64 via `-arch`, ubuntu x64, windows x64), strip,
    checksum.
  - PC-101 (fake backend): mirror the event vocabulary
    (ready/loaded/playing/volume/fadeout/exiting) so integration tests
    exercise the same shapes.
  - PC-205 (perceptual volume): replace the PoC's cubic curve with the real
    model; the ramp mechanism stays.
- PRD impact: none — §11.3 tier-1 assumptions confirmed.
- macOS arm64 (2026-07-19): stripped **325 632 B**, Null + **Core Audio**,
  `gapless: true`, fadeout→exiting clean. No `-ldl` on the link line.
- Follow-ups: Windows (and macOS x64 if needed) CI builds at PC-301; human
  audio QA of loop/fade quality at PC-309.
