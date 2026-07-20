# Sprint 1 — Walking Skeleton: hooks → daemon → fake audio (30 pts)

**Goal:** the full purr lifecycle works end-to-end — `UserPromptSubmit` fades in, `Stop` fades out — with the **fake audio backend**, deterministically, in CI on all three OSes. No real sound yet, on purpose: every state-machine and concurrency behavior gets a machine-checkable assertion before audio hardware enters the picture.

**Demo at sprint review:** run the integration suite; then wire the hook adapter into a real local Claude Code session and watch fake-audio log events appear on prompt submit and stop.

---

## PC-101 — Fake audio backend (3 pts, E5)

**As an** agent contributor / CI job, **I want** an `AudioBackend` implementation that writes timestamped playback events to a log instead of a sound card **so that** loop/fade/refcount logic is verifiable without audio hardware (§23.5).

- [x] Implements the full `AudioBackend` interface (§11.3): `detect`, `play`, `setVolume`, `stop(fadeOutMs)`.
- [x] Activated by `PURRCODE_FAKE_AUDIO=1`; wins tier detection when set.
- [x] Emits structured JSONL events: start, volume-change, fade-start, fade-cancel, stop — with timestamps and the **perceptual** volume value received (amplitude mapping lives in real adapters; ADR 0004 / PC-205).
- [x] Event vocabulary mirrors the sidecar protocol shapes where useful (`ready`/`playing`/`fadeout`/`exiting` may map onto the names above) so PC-109 and PC-301 exercise the same lifecycle (ADR 0004).
- [x] Test helper reads the log and asserts on event sequences (used by every integration test hereafter).

## PC-102 — Runtime directory (hardened) (2 pts, E3)

**As the** daemon, **I want** a safe per-user runtime directory **so that** predictable `/tmp` paths can't be exploited on shared hosts (FR-05, §13).

- [x] Platform resolution per the FR-05 table (`$XDG_RUNTIME_DIR` → `/tmp/purrcode-$UID` fallback; `$TMPDIR`; `%LOCALAPPDATA%`).
- [x] `mkdir` mode `0700`, then `lstat` verification: is a directory, not a symlink, owned by current user — refuse otherwise.
- [x] Unit tests: pre-created symlink rejected; wrong-owner rejected (where testable); fallback chain exercised.

## PC-103 — Control-pipe transport & message protocol (5 pts, E3)

**As the** system, **I want** a duplex UDS/named-pipe channel with a versioned message protocol **so that** hooks and the CLI are thin senders and the daemon is the single serialization point (FR-05).

- [ ] UDS (macOS/Linux) and named pipe (Windows) with UID/SID-embedded names, per PC-003 findings.
- [ ] Protocol: `start`, `stop`, `failure`, `session-end` (fire-and-forget) and `status`, `volume`, `preview`, `set-config` (request/response); newline-delimited JSON with a protocol version field; size-capped, schema-validated on receipt (§13: untrusted input).
- [ ] Client library shared by hook adapter and CLI; connect-before-send ordering guaranteed (connect-with-retry cold start per ADR 0003).
- [ ] Unit tests: malformed/oversized messages rejected without crashing the daemon.
- [ ] **PC-009:** Windows elevated↔non-elevated named-pipe interop is unpaid; loopback-TCP fallback stays **out of MVP** — failure degrades fail-silent (ADR 0003).

## PC-104 — Daemon core: lifecycle, spawn race, idle exit (5 pts, E3)

**As the** system, **I want** exactly one healthy daemon per user **so that** concurrency is serialized in one place with no lock choreography (FR-05).

- [ ] Fully detached spawn (new session, stdio ignored) per PC-003 findings; pidfile in runtime dir.
- [ ] **Socket bind is the spawn mutex:** loser of a spawn race detects the live socket and becomes a client (RR-05).
- [ ] **Cold-start guard:** activity clock initialized to boot time; idle-exit never evaluated while any client connection is open; idle-exit requires zero sessions + zero connections + grace period (FR-05 lifecycle).
- [ ] Clean shutdown on `shutdown` message and SIGTERM: fade out, snapshot, remove socket + pidfile.
- [ ] Integration tests: parallel spawn race; spawn-then-delayed-message must not self-terminate (the PRD's named race).

## PC-105 — Session registry & playback state machine (5 pts, E3)

**As the** daemon, **I want** the registry and the `idle → fading-in → playing → fading-out → idle` state machine **so that** multi-session refcounting and the fade races are correct by construction (FR-05, RR-05).

- [ ] Registry keyed by `session_id`: `startedAt`, `lastSeenAt`, `claudePid`; duplicate `start` from one session is idempotent; every event updates `lastSeenAt`.
- [ ] Playback driven by active-session count: 0→1 starts fade-in; last-session stop starts fade-out; **start during fading-out cancels the fade and resumes** (explicit transition).
- [ ] Repeated/unknown-session stop events are harmless no-ops (RR-03).
- [ ] Unit tests enumerate the full transition table, including fade-cancel and rapid start/stop interleavings.

## PC-106 — Registry snapshot & corruption recovery (2 pts, E3)

**As the** daemon, **I want** the registry snapshotted to disk and safely restored **so that** a daemon restart doesn't strand or hallucinate sessions (FR-05, RR-04.4).

- [ ] Atomic snapshot writes (temp + rename) on registry mutation (debounced).
- [ ] On boot: restore snapshot, then discard entries failing PID liveness checks.
- [ ] **Unreadable/corrupt snapshot triggers safe regeneration — never a crash, never hook-visible failure.**
- [ ] Unit tests: truncated JSON, wrong schema, dead-PID entries.

## PC-107 — Hook adapter (5 pts, E2)

**As** Claude Code, **I want** a transient handler for all four events **so that** the purr tracks the turn lifecycle and is completely invisible (FR-03, FR-04, RR-02).

- [ ] Entrypoint `dist/hook.js <event>` for `start|stop|failure|session-end`; reads stdin JSON as untrusted (schema-validate, size-cap, never interpolate into shell/paths).
- [ ] Extracts `session_id`; on `start`, captures Claude PID as **`process.ppid`** and a start-time token per ADR 0002 / 0006 (exec-form hooks only — string-form is forbidden; it breaks refcounting).
- [ ] Connects to daemon (spawning per PC-104 if absent), sends the message, exits.
- [ ] **Invisibility invariant:** exit 0 in *all* circumstances; zero bytes on stdout/stderr — enforced by a top-level catch-all and by tests injecting: daemon unreachable, malformed stdin, unwritable runtime dir, spawn failure. Cover **async** hook paths (ADR 0001: async stderr may be invisible today; still never write).
- [ ] Completes < 2 s under normal conditions (RR-01); errors go only to the debug log (PC-108).
- [ ] Respects `CI` / `CLAUDE_CODE_REMOTE=true` suppression: exit 0 immediately, do nothing (§16).
- [ ] **PC-009:** also suppress when `CLAUDE_CODE_ENTRYPOINT=sdk-cli` (headless `-p`); do not expect async `Stop` there — rely on `SessionEnd` (ADR 0001).

## PC-108 — Debug logging (2 pts, E2)

**As a** troubleshooting user, **I want** opt-in debug logs **so that** invisible-by-design failures are still diagnosable (FR-11).

- [ ] Disabled by default; `PURRCODE_LOG=debug` enables file logging (never stdout/stderr from hook paths).
- [ ] May contain: event type, timestamp, **hashed** session ID, PIDs, selected sound, playback errors. Must never contain: prompt text, responses, tool inputs, file contents, env values, credentials.
- [ ] Unit test greps a full-lifecycle debug log for forbidden content categories using seeded fixtures.

## PC-109 — End-to-end integration suite v1 (3 pts, E3/E4)

**As the** team, **I want** the PRD §18 core scenarios automated against the fake backend **so that** the skeleton's correctness is locked in before Sprint 2 builds on it.

- [ ] Scenarios: start → stop; start → failure; start → session-end; two sessions → one stop (purr continues) → final stop (fade); duplicate start; **start during fade-out** (fade-cancel event asserted); daemon-spawn race; cold-boot idle-exit guard.
- [ ] **PC-009:** include abandoned-turn stubs that Sprint 2 will deepen — owner PID gone with **no** stop event (Esc/kill path from ADR 0001/0006); headless/`sdk-cli` session that never emits async `Stop`.
- [ ] Runs headlessly on the full CI matrix via `pnpm e2e:fake-audio`.
- [ ] Test harness simulates hook invocations with realistic stdin payloads captured in PC-001.
