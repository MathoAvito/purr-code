# PurrCode — Epics

Epics E1–E8 are decomposed into stories in the sprint files (MVP scope). E9–E12 are Phase 2/3 epics, kept at epic level until the MVP retro.

---

## E1 — Technical Spikes & Foundations (Sprint 0)

De-risk the four load-bearing unknowns from PRD §19 Phase 0 / §21, and stand up the repo skeleton (TypeScript, pnpm, Vitest, CI matrix) so every later story lands in a working pipeline.

**Done when:** PRD Phase 0 exit criteria are demonstrated by a throwaway prototype (no orphaned player after stop/interrupt/kill; multi-session refcounting; runs on macOS/Linux/Windows), each open question in §21 has a decision record, and go/no-go is decided.

**PRD refs:** §19 Phase 0, §21, §20 (risk rows 1–4).

## E2 — Hook Adapter (Sprint 1)

The transient process Claude Code invokes on `UserPromptSubmit` / `Stop` / `StopFailure` / `SessionEnd`. Parses untrusted stdin JSON, extracts `session_id`, captures the Claude PID, sends one message to the daemon (spawning it if absent), and is *invisible*: exit 0 always, never a byte on stdout/stderr.

**Done when:** all four events round-trip to the daemon; failure injection (daemon dead, malformed stdin, unwritable runtime dir) never produces output or non-zero exit; handler completes < 2 s.

**PRD refs:** FR-03, FR-04, RR-01, RR-02, §13, §15.

## E3 — Player Daemon & Session Registry (Sprints 1–2)

The single per-user serialization point: UDS/named-pipe control channel, in-memory session registry with disk snapshot, playback state machine (`idle → fading-in → playing → fading-out → idle` with fade-cancel), hardened runtime directory, spawn-race handling, cold-start idle-exit guard.

**Done when:** the FR-05 message protocol is implemented and versioned; state-machine transitions (including start-during-fade-out) are unit-tested; daemon survives snapshot corruption; two hooks racing to spawn resolve via socket-bind mutex; idle-exit never fires while a client connection is open.

**PRD refs:** FR-05, RR-03, RR-05, §11.2, §13 (runtime-dir hardening).

## E4 — Reliability: Watchdog, TTL, Reconciliation (Sprint 2)

Everything that makes abandoned/suspended/crashed turns safe: state-aware PID watchdog (dead vs suspended vs running, per-platform), 10-minute stale TTL, full-registry reconciliation on every event, snapshot liveness checks on daemon boot.

**Done when:** integration suite covers owner-death (fade within 5 s), Ctrl+Z suspend → pause → `fg` resume, stale-session GC, and reconciliation-on-event — all against the fake audio backend, all deterministic in CI.

**PRD refs:** RR-04, §7 (abandoned-turn gap), §8 (interrupted/suspended story), §20 rows 1–2.

## E5 — Audio Engine & Backend Tiers (Sprint 3)

The `AudioBackend` abstraction and its four implementations: fake (built in E3 for testing, kept forever as the CI/agent backend), tier-1 bundled sidecar (gapless loop, fades, runtime volume; shipped per-platform via `optionalDependencies`, no postinstall), tier-2 mpv-over-IPC, tier-3 native players (respawn loop, hard stop, plays canonical WAV cache only). Perceptual volume mapping lives inside each adapter.

**Done when:** tier detection selects the best available backend; tier 1 verified gapless with clean fades on all three OSes; tier 3 honestly degrades and always plays the WAV cache; volume curve unit tests pass (monotonic, 0 = mute, no double-application on mpv).

**PRD refs:** FR-06, FR-07 (default sound only in MVP), FR-08 (WAV cache mechanism only), §11.3, §16 audio quality.

## E6 — CLI & Doctor (Sprint 3)

User-facing command surface for MVP: `on|off`, `status`, `volume`, `preview`, `doctor`, plus the internal `hook <event>` entrypoint. Doctor performs the full FR-10 checklist. Playful-but-informative tone, `NO_COLOR` respected, screen-reader-safe output.

**Done when:** every MVP command works against a live daemon; volume changes affect the *currently playing* loop; `doctor` detects the documented failure classes (disableAllHooks, missing backend, unowned runtime dir, stale sessions); CI/remote env-var suppression works.

**PRD refs:** FR-09, FR-10, §16.

## E7 — Plugin Packaging, Install & Uninstall (Sprint 4)

Claude Code plugin as the sole MVP distribution: `hooks/hooks.json` in exec form with `${CLAUDE_PLUGIN_ROOT}`, state in `${CLAUDE_PLUGIN_DATA}`, `npx purr-code install` as the front door (registers plugin, installs default purr + WAV cache, verifies playback), clean idempotent uninstall.

**Done when:** install is one command and idempotent; `settings.json` is untouched; uninstall removes plugin, daemon, and runtime state (imported audio retained absent `--purge`); install output matches §14's UX.

**PRD refs:** FR-01, §8 install/uninstall stories, §14, §15. (FR-02 direct-hook fallback is Phase 2 → E10.)

## E8 — OSS Surface & v0.1.0 Release (Sprint 4)

Community health files (README, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, AGENTS.md + CLAUDE.md pointer, issue/PR templates, CODEOWNERS, ASSETS.md), DCO check, branch protection, fork-PR CI security rules (pull_request trigger only, zero secrets, SHA-pinned actions), Changesets, protected release environment, npm publish with provenance.

**Done when:** every §22 Definition-of-Done checkbox is met and v0.1.0 is on npm.

**PRD refs:** §13 supply chain, §19 Phase 1 OSS surface, §22, §23.1–23.3, 23.5–23.6.

---

# Phase 2/3 epics (epic level only — break down after MVP retro)

## E9 — Sound Library & Custom Import (Phase 2, v0.5.0)

Remaining three bundled purrs (`kitten`, `diesel`, `debugger`) with CC0/original provenance in ASSETS.md; `purrcode sound add|use|remove|list` with magic-byte validation, name sanitization, size cap, copy-into-data-dir, WAV-cache transcode at import; MP3-import warning. **PRD refs:** FR-07, FR-08, §23.4.

## E10 — Direct-Hook Fallback Installer (Phase 2)

`purrcode install --hooks` writing exec-form absolute-path hooks into `~/.claude/settings.json`: safe JSON parse (never overwrite invalid), atomic write + timestamped backup, duplicate detection, exact-command-string bookkeeping for surgical uninstall. **PRD refs:** FR-02, §8 uninstall fallback criteria, §14.

## E11 — WSL Support & Fade/Backend Polish (Phase 2)

WSLg/PulseAudio detection with honest degradation via doctor; improved fade quality; automated npm releases with provenance; sound-submission lane live; Scorecard ≥ 7.0 + CodeQL; templates hardened from real triage. **PRD refs:** §11.3 WSL row, §19 Phase 2, §23.3–23.4.

## E12 — Stabilization to v1.0.0 (Phase 3)

`schemaVersion` migrations and stable config schema; backward-compatible CLI guarantee; full platform matrix; audio licensing audit; security review; support policy; OpenSSF Best Practices badge; ≥2 co-maintainers; `purrcode pspsps` (objectively unnecessary and therefore mandatory). **PRD refs:** §19 Phase 3, §23.6.
