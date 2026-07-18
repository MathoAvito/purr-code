# Sprint 3 — Real Audio, CLI & Doctor (30 pts)

**Goal:** the cat becomes audible. Tier-1 sidecar plays a gapless, fading purr on macOS/Linux/Windows; tier detection degrades honestly; the MVP CLI surface (`on/off`, `status`, `volume`, `preview`, `doctor`) works against the live daemon.

**Human gate this sprint:** manual audio QA (PC-309) — seams, pops, 15-minute fatigue — cannot be delegated to agents or CI.

---

## PC-301 — Tier-1 sidecar: production build & protocol (8 pts, E5)

**As a** user, **I want** the bundled player **so that** gapless looping, runtime volume, and clean fades work with zero external dependencies (§11.3 tier 1).

- [ ] Productionize the PC-004 prototype (miniaudio or rodio per the decision record): load file, gapless loop, set-volume, fade-out-and-exit, fade-in on start; crash-safe (parent daemon detects exit).
- [ ] Control protocol between daemon and sidecar per PC-004's design; sidecar receives amplitude derived from the perceptual model (PC-205) inside this adapter.
- [ ] CI builds for macOS arm64/x64, Linux x64, Windows x64 **from source, with published checksums** (§13); binaries a few hundred KB; packaged as per-platform npm `optionalDependencies`, **no postinstall scripts**.
- [ ] `AudioBackend` adapter: `detect` verifies the platform binary is present and executable; `play/setVolume/stop` map to the protocol.
- [ ] Integration: full lifecycle suite (PC-109 scenarios) passes with tier 1 on a developer machine (CI keeps using fake audio).

## PC-302 — Tier detection & backend selection (3 pts, E5)

**As the** daemon, **I want** ordered backend detection **so that** every machine gets the best available experience and degradation is honest (§11.3).

- [ ] Detection order: fake (env var) → tier-1 sidecar → mpv → tier-3 native → none; result cached per daemon lifetime, re-detected on daemon restart.
- [ ] `BackendCapabilities` (loop, fade, runtime volume) recorded and exposed via `status`/`doctor`.
- [ ] "None available" is a defined state: daemon stays healthy, hooks stay silent, doctor explains.
- [ ] Unit tests with mocked binary presence for each detection branch.

## PC-303 — Tier-2 mpv adapter (3 pts, E5)

**As a** user with mpv installed but no working sidecar, **I want** full-quality playback via mpv's IPC socket (§11.3 tier 2).

- [ ] Detect mpv on PATH (detection only — hook commands themselves never rely on PATH); spawn with `--input-ipc-server`, loop, no video, no OSD.
- [ ] Volume/fades via IPC `volume` property; **pass the perceptual 0–100 value through — mpv applies its own curve; no double-mapping** (FR-06).
- [ ] Fade-out implemented as a volume ramp then quit; fade-cancel supported.
- [ ] Integration test behind an `mpv`-present guard (runs where installed, skipped elsewhere).

## PC-304 — Tier-3 degraded adapter + canonical WAV cache (5 pts, E5)

**As a** user with no sidecar and no mpv, **I want** the purr to still work, honestly degraded **so that** tier 3 never fails on codec support (§11.3, FR-08 WAV cache).

- [ ] WAV-cache module: transcode any bundled/imported sound to canonical WAV once (via the tier-1 sidecar's decode path per FR-08), stored alongside the original in the data directory; idempotent, verified at install.
- [ ] Adapters for `afplay` (macOS), `paplay`/`aplay` (Linux), PowerShell playback (Windows): respawn-on-exit looping (seamed — documented), hard stop, no runtime volume.
- [ ] **Tier 3 always plays the WAV cache, never the original** — removes the `afplay`-can't-decode-OGG failure class entirely.
- [ ] Capabilities honestly reported (no fades, seamed loop) for doctor.
- [ ] Unit tests: WAV cache generation/idempotency; respawn loop stops cleanly on stop.

## PC-305 — Default `sleepy` purr asset (2 pts, E5) — human gate on licensing

**As a** user, **I want** a purr that loops seamlessly and doesn't irritate over long turns (FR-07, §16).

- [ ] Source or produce `sleepy`: original recording or verified CC0; mono OGG (WAV cache generated at install); loop points cut for gaplessness.
- [ ] `ASSETS.md` created with per-file provenance and license (§23.1) — human verifies the licensing claim.
- [ ] Passes manual audio QA in PC-309. (Other three presets are Phase 2 / E9 — natural `good first issue`s.)

## PC-306 — CLI core: on/off, status, volume, preview (5 pts, E6)

**As a** user, **I want** to control the purr without editing JSON (FR-09, §8 configuration story).

- [ ] `purrcode on|off`: flips `enabled` in config *and* messages the daemon (off during playback fades out immediately). Optional aliases `mute`/`unmute`.
- [ ] `purrcode volume <0-100>`: validates, persists, applies to the **currently playing** loop via the control pipe.
- [ ] `purrcode status`: daemon health, active/paused session count, playback state, backend tier + capabilities, selected sound, volume.
- [ ] `purrcode preview [name]`: plays a few seconds through the active real backend (bypasses the fake env var), works without any Claude session.
- [ ] UX per §16: playful-but-informative, errors explain what happened and how to fix it, `NO_COLOR` respected, no meaning carried by emoji/color alone.
- [ ] Command-level tests against a live daemon with the fake backend (except preview's real-backend path, covered in manual QA).

## PC-307 — `purrcode doctor` (3 pts, E6)

**As a** user with a silent cat, **I want** one command that finds the problem (FR-10).

- [ ] Checks: Claude Code installed + version; installation mode + hook presence/duplication; plugin/settings validity; **`disableAllHooks` in any settings scope**; `CI`/`CLAUDE_CODE_REMOTE` suppression state; backend tier + capabilities; config/runtime dir writability + runtime-dir ownership; daemon health, socket reachability, registry validity, paused sessions; selected-sound integrity (file + WAV cache); platform support.
- [ ] Output format per the FR-10 example, ending with a one-line verdict ("The cat appears healthy.").
- [ ] Each failed check prints a concrete fix suggestion; exit code reflects health (0 healthy, 1 problems) for scriptability.
- [ ] Tests: fixture-driven scenarios for each failure class the checks can detect.

## PC-308 — Documented failure-mode sweep (1 pt, E6)

- [ ] Manually induce each §20 operational risk reachable at this stage (hook resolution failure, missing backend, unowned runtime dir, suspended owner) and confirm doctor identifies it; file gaps as bugs.

## PC-309 — Manual audio QA (§18) (as needed, E5) — human gate

- [ ] `sleepy` on headphones and speakers, all three OSes: seam audibility, pops on fade edges, volume consistency, 15-minute fatigue listen, fade-in/out quality at multiple volume settings.
- [ ] Tier-3 seamed-loop degradation subjectively acceptable; recorded expectations in README troubleshooting notes.
