# Sprint 2 — Reliability & Reconciliation (27 pts)

**Goal:** the abandoned-turn gap (§7) is closed. Esc, Ctrl+Z, terminal kill, machine crash, daemon restarts — none of them leave a purring orphan. All RR-01…RR-05 behaviors pass the integration suite on the CI matrix.

**Demo at sprint review:** kill a terminal mid-turn → fake-audio fade event ≤ 5 s. Suspend via **SIGSTOP** (not Ctrl+Z/SIGTSTP — Claude swallows SIGTSTP; ADR 0002) → pause event; SIGCONT → resume event.

---

## PC-201 — Process liveness & state classification (5 pts, E4)

**As the** watchdog, **I want** a per-platform module classifying a PID as running / suspended / dead **so that** state-aware decisions (RR-04.1) rest on tested primitives.

- [x] Linux: parse `/proc/[pid]/stat` state field (handles comm names containing spaces/parens); `T` = suspended; **`Z`/`X` = dead** (zombie/dead — do not treat as alive; ADR 0006 amends ADR 0002).
- [x] macOS: `ps -o state= -p <pid>`; `T` = suspended.
- [x] Windows: existence-only per PC-002 findings.
- [x] PID-reuse guard: identity is **`(pid, starttime)`** per ADR 0002 — required, not optional.
- [x] Unit tests with real child processes: spawn, SIGSTOP, SIGCONT, kill — assert classification at each step (Unix); existence checks on Windows. Include a zombie-state fixture on Linux (`Z` → dead).

## PC-202 — Watchdog loop (5 pts, E4)

**As a** user who pressed Esc, hit Ctrl+Z, or closed the terminal, **I want** the purr to stop promptly even though no stop event fired (§8, RR-04).

- [x] Every 2–5 s the daemon classifies each session's `claudePid`.
- [x] **Dead** → remove session; if active count hits zero, fade out. End-to-end bound: fade starts ≤ 5 s after owner death.
- [x] **Suspended** → mark session *paused* (not removed); when no non-paused sessions remain, fade out. On return to running with the turn still open, fade back in.
- [x] Watchdog ticks are cheap (no subprocess spawn per tick where avoidable) and never block the control pipe.
- [x] Integration tests (fake backend, real child processes standing in for Claude): owner-kill ≤ 5 s fade; SIGSTOP → pause within one cycle → SIGCONT → resume; one-suspended-one-running keeps purring.
- [x] **PC-009:** Esc/kill fire **no** Stop (ADR 0001) — this loop is the **primary** abandoned-turn cleanup path, not a backup. Tests must cover owner death with zero stop/failure events.

## PC-203 — Stale-session TTL & event-driven reconciliation (3 pts, E4)

**As the** daemon, **I want** TTL expiry plus full-registry reconciliation on every incoming event **so that** no single mechanism is a single point of failure for cleanup (RR-04.2–.3).

- [ ] Sessions with no events for `staleSessionMinutes` (default 10, configurable) are garbage-collected.
- [ ] Every incoming message triggers reconciliation of *all* sessions (liveness + TTL), not just the sender's.
- [ ] Daemon-boot reconciliation (extends PC-106): snapshot entries re-validated before playback resumes.
- [ ] Integration tests: stale session GC'd on the next unrelated event; TTL expiry alone stops playback.

## PC-204 — Configuration store & schema (3 pts, E6)

**As the** system, **I want** persistent user configuration with the FR-06 defaults **so that** volume/sound/toggles survive restarts and future versions can migrate.

- [ ] Config file in the user data directory with FR-06 defaults (`enabled`, `sound`, `volume`, `fadeInMs`, `fadeOutMs`, `staleSessionMinutes`) and `schemaVersion` from day one.
- [ ] Atomic writes; refuses to follow unexpected symlinks (§13); unknown keys preserved on rewrite.
- [ ] Validation with per-field fallback to defaults on invalid values (never crash, never hook-visible).
- [ ] Daemon watches/reloads config on `set-config` messages so changes apply to the current loop.

## PC-205 — Perceptual volume model (3 pts, E5)

**As a** user, **I want** volume 0–100 to sound linear to my ears **so that** 20 is subtle and 60→100 isn't imperceptible (FR-06).

- [ ] Shared perceptual model: `gain_dB = −60 + 0.6·v`, `v=0` → hard mute; conversion helpers to linear amplitude.
- [ ] The mapping is applied **inside each backend adapter**, not the daemon — the fake backend records the perceptual value; the amplitude conversion is exercised via the tier-1/tier-3 adapters in Sprint 3; the mpv adapter must pass the perceptual value through (its own curve applies — no double-mapping).
- [ ] Fade ramps interpolate in the perceptual domain.
- [ ] Unit tests: monotonicity over 0–100, 0 = mute, ramp shape, and an adapter-contract test asserting single application per tier.

## PC-206 — Failure-injection & chaos test pass (5 pts, E2/E3/E4)

**As the** team, **I want** systematic failure injection **so that** "fail open, fail silent" (RR-02) is demonstrated, not asserted.

- [ ] Hook adapter under: daemon dead, socket present-but-unresponsive, runtime dir unwritable, stdin garbage/oversized, spawn failure → always exit 0, always silent.
- [ ] Daemon under: backend `play()` throwing, player handle dying mid-loop (respawn/recover), snapshot write failure, SIGTERM mid-fade.
- [ ] Player-crash-during-active-session scenario from §18 integration list.
- [ ] Rapid-fire stress: 50 interleaved start/stop messages across 5 fake sessions — final state consistent, no stuck fades.

## PC-207 — Suspend/resume turn-state correctness (3 pts, E4)

**As a** user, **I want** resume-from-suspend to purr only if the turn is actually still open **so that** `fg` at an idle shell prompt doesn't restart the purr (§20 row 2 nuance).

- [ ] Paused sessions keep their registry entry and turn state; resume re-checks whether a stop/session-end arrived while suspended.
- [ ] TTL continues counting during suspension (a session suspended > `staleSessionMinutes` is GC'd — decision recorded if spike evidence suggests otherwise).
- [ ] Integration tests: suspend → stop event arrives → resume → **no** playback; suspend → resume with turn open → playback resumes.
- [ ] **PC-009:** drive suspend/resume tests with **SIGSTOP/SIGCONT**, not SIGTSTP (Claude Code handles SIGTSTP itself; ADR 0002).
