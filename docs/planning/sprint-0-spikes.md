# Sprint 0 — Technical Spikes & Scaffolding (29 pts)

**Goal:** answer every PRD §21 open question and §19 Phase 0 deliverable with evidence, and leave a repo where Sprint 1 stories can land in CI on day one.
**Exit gate:** PC-009 go/no-go review. Findings that contradict PRD assumptions update the backlog *before* Sprint 1 starts.

All spikes (PC-001…PC-007) produce a decision record in `docs/decisions/` per the working agreement. Spikes are timeboxed at their point value in effort — they answer questions, they don't build product code.

---

## PC-001 — Spike: hook payload & lifecycle verification (5 pts, E1)

**As the** architect, **I want** verified hook behavior on current Claude Code versions **so that** the whole design isn't resting on documentation that drifted.

Verify on macOS + Linux + Windows, with a throwaway logging hook:

- [x] `UserPromptSubmit`, `Stop`, `StopFailure`, `SessionEnd` fire when documented; capture actual stdin JSON payloads.
- [x] `session_id` is present on every event and stable within a session.
- [x] **Does Esc-interrupt fire `Stop`?** (§21 Q1 — record per-platform; the design must stay correct either way.) → **No** on Linux; neither does SIGKILL. Watchdog is essential.
- [x] `async: true` hooks confirmed non-blocking; deliberately slow hook does not delay the prompt.
- [x] Confirm stdout on `UserPromptSubmit` is injected into context, and non-zero exit / stderr surfaces a transcript notice (validates the fail-silent invariant's stakes). → True for *sync* hooks; async stdout/stderr is silently discarded on v2.1.197.
- [x] Headless `-p` mode: which events fire, and what's the best suppression signal? (§21 Q3) → async `Stop` never fires in `-p`; suppress via `CLAUDE_CODE_ENTRYPOINT=sdk-cli`.
- [x] Exact hooks.json schema (`command`+`args` exec form, `timeout`, no `matcher`) re-validated against the shipped version (§15).

> Findings: [decision record 0001](../decisions/0001-hook-payload-lifecycle.md), evidence in `spikes/pc-001-hook-payload/`. Verified on Claude Code v2.1.197, **Linux only** — macOS/Windows runs outstanding, flagged for PC-009.

## PC-002 — Spike: Claude PID capture & process-state detection (3 pts, E1)

**As the** daemon designer, **I want** a proven liveness signal for the owning Claude Code process **so that** the watchdog (RR-04) is built on a real handle, not an assumption.

- [x] Hook's parent PID at spawn identifies the Claude Code process on all three OSes (§21 Q2); document an alternative if hooks are reparented (e.g. `CLAUDE_*` env vars, ancestor walk). → Verified on Linux (exec form: ppid **is** the `claude` PID; ancestor walk works as fallback).
- [x] Suspended-state detection works at watchdog cadence: `/proc/[pid]/stat` state `T` (Linux), `ps -o state=` (macOS); Ctrl+Z → detect within one 2–5 s cycle → `fg` → detect running again. → Linux: `T` and resume both detected on the first 2 s poll. Nuance: Claude Code *handles* SIGTSTP/^Z (no suspend); `SIGSTOP` is the real suspend path. macOS untested.
- [x] Confirm Windows is existence-only (no common suspend equivalent) and pick the existence-check API. → `process.kill(pid, 0)` (wraps `OpenProcess`); documented, unverified on Windows.
- [x] PID-reuse risk assessed (PID recycled between checks): record whether start-time verification is needed. → Adopted: `(pid, starttime)` from `/proc/[pid]/stat` field 22; one-read cheap, closes the hole.

> Findings: [decision record 0002](../decisions/0002-pid-capture-process-state.md), evidence in `spikes/pc-002-pid-process-state/`. **Linux only** — macOS/Windows flagged for PC-009.

## PC-003 — Spike: control-pipe transport on all platforms (3 pts, E1)

**As the** daemon designer, **I want** the UDS/named-pipe transport validated **so that** the Windows-ACL risk (§20 row 3) is retired or has a designed fallback.

- [x] UDS echo round-trip on macOS/Linux from Node 20+, socket in runtime dir, per-UID naming. → Linux: p50 0.023 ms; `0700` dir + `0600` socket, lstat-verified. macOS untested.
- [x] Windows named pipe with per-SID naming; duplex request/response works. → Prototype written (`win32-named-pipe.mjs`), per-SID naming designed; **execution owed at PC-009** (no Windows machine).
- [x] **Elevated ↔ non-elevated interop** on Windows: document the failure mode and whether the last-resort fallback (loopback TCP + 0600 secret token, never unauthenticated UDP) is needed for MVP or deferrable. → Documented (expected `ERROR_ACCESS_DENIED`); recommendation: fallback **deferrable** — failure degrades fail-silent.
- [x] Fully detached daemon spawn verified (new session, stdio ignored, survives parent exit) on all three OSes. → Linux verified (own sid, survives spawner death); macOS/Windows owed at PC-009.
- [x] Cold-start sequencing prototyped: client connects before first message; daemon never idle-exits with an open connection (FR-05 lifecycle rule). → Connect-with-retry hit on attempt 2 (26 ms); idle daemon survived a held connection 2.6× its timeout and exited 1.6 s after close.

> Findings: [decision record 0003](../decisions/0003-control-pipe-transport.md), evidence in `spikes/pc-003-control-pipe/`. **Linux only** — macOS/Windows flagged for PC-009.

## PC-004 — Spike: tier-1 audio sidecar selection (5 pts, E1)

**As the** audio engineer, **I want** a chosen and proven tier-1 player **so that** gapless loop + runtime fades + runtime volume are demonstrated, not hoped for.

- [x] Compare miniaudio (C) vs rodio (Rust) for: gapless OGG/WAV looping, runtime volume, fade-in/out ramps, binary size (target: few hundred KB), cross-compilation story. → **miniaudio selected**: 347 KB stripped (WAV-only), zero build-time audio deps, native CI builds (no cross-compilation needed). rodio compared on docs only. OGG needs stb_vorbis (PC-301 decision).
- [x] Build proof-of-concept binaries for macOS arm64/x64, Linux x64, Windows x64; loop a test WAV gaplessly with an audible fade-out on command. → Linux x64 built + verified (sample-exact seam check, ramped fade-out, real-device run OK). macOS/Windows builds owed at PC-009 — source is portable, CI runners are native.
- [x] Define the sidecar control protocol (stdin line protocol vs socket) — must support: load, play-loop, set-volume (perceptual value), fade-out-and-exit. → **stdin line protocol**: `LOAD/PLAY/VOLUME 0-100/FADEOUT ms/QUIT`, JSON events on stdout, stdin EOF = orphan cleanup.
- [x] Confirm `optionalDependencies` distribution shape (esbuild-style per-platform packages, **no postinstall scripts**). → Confirmed empirically with npm 10: only the os/cpu-matching package installs; PC-008 placeholders already match.

> Findings: [decision record 0004](../decisions/0004-audio-sidecar-selection.md), PoC + evidence in `spikes/pc-004-audio-sidecar/`. **Linux x64 only** — macOS/Windows builds flagged for PC-009. Perceptual QA is PC-309 (human).

## PC-005 — Spike: plugin packaging validation (3 pts, E1)

**As the** release engineer, **I want** the plugin path proven **so that** "plugin-first, never touch settings.json" (FR-01) is confirmed viable.

- [x] Minimal plugin with `hooks/hooks.json` installs and fires hooks via `${CLAUDE_PLUGIN_ROOT}` exec form on all three OSes. → Verified on Linux (local marketplace → install → hooks fire with `CLAUDE_PLUGIN_ROOT` + `CLAUDE_PLUGIN_DATA` set); macOS/Windows owed at PC-009.
- [x] `${CLAUDE_PLUGIN_DATA}` persistence verified across a plugin update. → Marker survived 0.0.1→0.0.2 update. **Caveat: `uninstall` deletes it unless `--keep-data`** — user-precious state goes in PurrCode's own config dir.
- [x] Enable/disable mechanism mapped to `purrcode on|off` semantics (or documented divergence). → `claude plugin disable` gates hooks to zero events; `enable` resumes. Direct mapping, no divergence.
- [x] Local-install vs marketplace registration flow documented for the installer (E7). → Both flows documented in ADR 0005; `plugin update` needs full `name@marketplace` id; `claude plugin validate` available for CI.

> Findings: [decision record 0005](../decisions/0005-plugin-packaging.md), harness + evidence in `spikes/pc-005-plugin-packaging/`. **Linux only** — macOS/Windows flagged for PC-009.

## PC-006 — Spike: multi-session prototype (2 pts, E1)

**As the** architect, **I want** two simultaneous Claude Code sessions driven against the prototype daemon **so that** refcounting semantics are validated with real event streams.

- [ ] Two terminals, interleaved prompts: purr continues until the *last* active session stops.
- [ ] Terminal killed mid-turn: prototype watchdog fades out ≤ 5 s, no orphaned player (Phase 0 exit criterion).

## PC-007 — Spike: name check & trademark hygiene (1 pt, E1)

- [ ] npm, GitHub org/repo, and basic trademark search for `purrcode`; confirmed distinct from `claude-purr`; no "Claude" in package name (§21 Q5). Record the final name — human decision.

## PC-008 — Repo scaffolding & CI matrix (5 pts, E1)

**As a** contributor (human or agent), **I want** a working monorepo skeleton **so that** every subsequent story lands with tests in CI.

- [x] pnpm workspace, TypeScript strict, Node 20+, Vitest, ESLint + Prettier; committed lockfile.
- [x] Package layout: `packages/cli` (hook adapter + CLI + daemon), `packages/sidecar-*` placeholders for platform binaries.
- [x] GitHub Actions CI on macOS/Ubuntu/Windows: lint, typecheck, unit tests. **All actions SHA-pinned from the first commit; top-level `permissions: {contents: read}`** (§23.3 — cheaper to start right than retrofit).
- [x] `docs/decisions/` with the ADR template; PRD committed to the repo (§23.6: the PRD is the roadmap).

## PC-009 — Go/no-go review & backlog reconciliation (1 pt, E1) — human gate

- [ ] All decision records reviewed; Phase 0 exit criteria (§19) checked off.
- [ ] Sprint 1–4 backlog amended where findings contradict PRD assumptions (e.g., if Esc *does* fire `Stop`, watchdog stays but test emphasis shifts; if parent PID is unreliable, E4 stories change).
- [ ] Any PRD amendments filed as PRs against the in-repo PRD.

## PC-010 — Reserve package name & repo (1 pt, E1) — human gate

- [ ] npm name published as placeholder (or reserved), GitHub repo created, MIT license file. Depends on PC-007.
