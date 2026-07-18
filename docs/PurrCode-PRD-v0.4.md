# Product Requirements Document: PurrCode

**Status:** Draft
**Version:** 0.4
**Date:** July 17, 2026
**License:** MIT
**Working title:** PurrCode
**Tagline:** *Claude works. Claude purrs.*

> Naming note: avoid publishing under `claude-purr` (an unrelated Claude Code voice-control project). Additionally, keep "Claude" out of the npm package name and primary branding to avoid trademark issues; verify npm, GitHub, and trademark availability before release.

**Changes in v0.4 (open-source operations):**

1. New **Section 23: Open Source Operations** covering community health files, contribution workflow (DCO, Changesets, branch protection), fork-PR CI security, a strict sound-contribution policy, governance, and OpenSSF Scorecard/Best Practices alignment.
2. First-class **AI-agent contributor support**: `AGENTS.md` as the canonical repo context file (with `CLAUDE.md` referencing it), a headless fake-audio backend so agents can verify changes without sound hardware, and an explicit AI-assisted contribution policy.
3. Release plan, success metrics, risks, and Definition of Done updated with OSS deliverables (Scorecard score target, community files in Phase 1, Best Practices badge at v1.0, AI-slop-PR risk row).

**Changes in v0.3 (edge-case review):**

1. Watchdog upgraded from PID-existence to **process-state checks**: a Claude Code process suspended with Ctrl+Z (`SIGTSTP`/`SIGSTOP`) is alive but frozen and emits no `Stop` event; the purr now fades out on suspend and resumes on `fg`.
2. Volume is now defined as a **perceptual (logarithmic) scale**, mapped to amplitude per-backend inside the audio abstraction (mpv applies its own curve; applying ours on top would double it).
3. Daemon **cold-start/idle-exit rules made explicit**: activity clock starts at boot and the daemon never exits while a client connection is open, structurally eliminating the spawn-then-self-terminate race.
4. Added a **canonical WAV cache**: every bundled and imported sound is transcoded to WAV once, and degraded (tier 2/3) backends always play the WAV. Native players are format-unreliable (`afplay` cannot decode OGG at all; `aplay` is PCM-only), so format hazards are removed rather than warned about.
5. Control-pipe decision documented: **UDS/named pipes retained** over loopback UDP, which offers no peer authentication and would let any local process command the daemon. Pipe names are per-user (UID/SID); Windows elevated↔non-elevated interop added to the Phase 0 spike.

**Changes in v0.2 (review against the Claude Code hooks reference):**

1. Distribution is now **plugin-first**. Direct `settings.json` hook surgery is demoted to a fallback path, eliminating the previous "installer damages settings" critical risk.
2. Hooks are configured in **exec form with absolute paths** and `async: true`. `npx` is banned from hook commands. This fixes the PATH-resolution failure mode (which would print a visible hook-error notice in the transcript on every prompt) and removes hook latency from the critical path.
3. Added a **PID watchdog** and reduced stale-session TTL from 120 to 10 minutes, closing the user-interrupt gap (Esc likely does not fire `Stop`; a spike task verifies this).
4. Audio backend redefined as an explicit **three-tier strategy**; native OS players are formally the degraded tier because none of them support runtime fade-out.
5. Introduced a **player daemon with a local control pipe** as the concurrency serialization point, replacing lock-heavy registry choreography.
6. Resolved open questions: `session_id` is the documented stable identifier; imported audio is copied; bundled loops are OGG/WAV only.
7. Hardened runtime-directory creation, uninstall identification, and import validation (magic bytes).

---

## 1. Executive Summary

PurrCode is an open-source Claude Code addon that plays a continuous, seamless cat-purring sound while Claude is processing an active user turn.

When the user submits a prompt, the purring fades in. When Claude finishes responding, encounters an API failure, or the session closes, the purring fades out and the audio process is cleaned up.

The product must require one installation command, work globally across Claude Code projects, consume minimal system resources, make no network requests during normal operation, and never interfere with Claude Code execution — including never surfacing hook-error notices in the Claude Code transcript.

PurrCode ships primarily as a **Claude Code plugin**, so it never modifies the user's `settings.json` in the default path.

PurrCode is intentionally narrow. It is not a general background-music player, notification system, or desktop application. Its charm comes from doing one ridiculous thing extremely well.

---

## 2. Problem Statement

Claude Code can spend significant time planning, reading files, executing tools, and generating responses. During these periods, users often lack passive feedback indicating whether Claude is still active, finished, waiting for permission, or stuck.

Existing tools solve adjacent problems: completion notification sounds, desktop notifications, general background music, tool-specific sound effects, and ambient coding soundscapes. Codevator already plays background audio while coding agents work, but is positioned as a broader background-music system with modes, profiles, Spotify support, and statistics.

PurrCode differentiates itself through:

- A cat-specific identity
- Near-zero configuration
- A tiny implementation
- Seamless purr loops and fades
- Reliable multi-session process management
- No account, telemetry, UI, or network dependency
- Viral, joke-project appeal without being technically sloppy

---

## 3. Product Vision

Make Claude Code feel like a tiny digital cat happily working inside the terminal.

```text
$ npx purrcode install

✓ PurrCode plugin installed
✓ Default purr activated
✓ Volume set to 20%

Claude will now purr while working. 🐈
```

From that point onward:

```text
User submits prompt → purr fades in → Claude works → Claude finishes → purr fades out
```

No daemon configuration, manual hook editing, audio-player selection, or project-by-project setup is required.

---

## 4. Goals

### 4.1 Primary goals

1. Start purring automatically when the user submits a Claude Code prompt.
2. Stop purring reliably when Claude's turn ends — including turns ended by user interrupt, terminal closure, or crash.
3. Never block or delay Claude Code (all hooks run `async`), and never surface errors into the Claude Code transcript or model context.
4. Support macOS, Linux, Windows, and WSL.
5. Support multiple simultaneous Claude Code sessions without one session incorrectly stopping another session's audio.
6. Install and uninstall cleanly without touching unrelated Claude Code configuration.
7. Work entirely locally with no telemetry or network access at runtime.
8. Provide a polished experience suitable for public open-source release.

### 4.2 Secondary goals

1. Offer several bundled purr personalities.
2. Let users import their own audio loop.
3. Allow runtime volume and enable/disable controls that affect the currently playing loop.
4. Provide a diagnostic command for hook and audio problems.
5. Make the project easy for first-time contributors to understand.

---

## 5. Non-Goals

The initial product will not:

- Play music or Spotify streams
- Generate purr audio using AI
- Analyze prompt contents or read conversation transcripts
- Modify Claude's prompts or responses
- Provide desktop notifications, a GUI, or a menu-bar application
- Support unrelated coding agents in the MVP
- Synchronize settings between machines or upload usage data
- Detect Claude's private internal reasoning state

PurrCode should not become "Codevator, but with cats." Scope discipline is part of the product.

---

## 6. Target Users

**Primary:** a developer who uses Claude Code regularly, runs medium/long agentic tasks, wants passive feedback that Claude is active, enjoys playful developer tools, and prefers one-command installation.

**Secondary:** streamers and coding-content creators, open-source enthusiasts, developers who leave Claude running in another terminal, teams experimenting with harmless DX toys, and cat owners with unrealistic expectations of software.

---

## 7. Product Definition of "Thinking"

Claude Code hooks expose lifecycle events rather than a perfect signal of internal model reasoning.

For PurrCode, **thinking** is defined as:

> The active Claude turn beginning when the user submits a prompt and ending when Claude finishes, the turn fails, or the turn is abandoned.

Claude Code's per-turn events are `UserPromptSubmit`, `Stop`, and `StopFailure`; sessions are bracketed by `SessionStart` and `SessionEnd`. Every hook event delivers a documented `session_id` field on stdin, which PurrCode uses as the stable session identifier.

| Event | PurrCode action | Notes |
|---|---|---|
| `UserPromptSubmit` | Mark session active; start/acquire playback | stdout is added to Claude's context on this event — the hook must print nothing |
| `Stop` | Mark session idle; release playback | Fires when Claude finishes responding |
| `StopFailure` | Mark session idle; release playback | Fires on API-error turn end; hook output and exit code are ignored by Claude Code |
| `SessionEnd` | Force cleanup for the session | Fires on `/clear`, exit, logout, etc. |

**The abandoned-turn gap:** a user pressing Esc mid-turn, killing the terminal, or crashing the machine may produce **no stop event at all**. PurrCode therefore never assumes event symmetry. Reconciliation mechanisms (RR-04): a PID watchdog on the Claude Code process, a short stale-session TTL, and re-reconciliation on every subsequent event. Whether Esc fires `Stop` on current Claude Code versions is a Phase 0 spike deliverable; the design must remain correct either way.

---

## 8. User Stories

### Installation

**As a Claude Code user,** I want to install PurrCode with one command so that I never edit hook JSON manually.

Acceptance criteria:

- Installation completes with one command and is idempotent.
- The default path installs a plugin; the user's `settings.json` is not modified.
- Installation reports what was installed and where.
- The fallback direct-hook path (FR-02) creates a timestamped backup before changing user configuration.

### Active purring

**As a user,** I want the purr to start shortly after I submit a prompt.

Acceptance criteria:

- Playback begins within 500 ms of prompt submission on a warm system.
- The hook runs `async` and never delays prompt processing, regardless of Node startup time or audio backend state.
- Audio starts with a configurable fade-in.
- Hook failures are invisible: exit code 0, no stdout, no transcript notices.

### Completion

**As a user,** I want the purr to stop when Claude finishes so that silence means the turn is complete.

Acceptance criteria:

- Fade-out begins within 250 ms of the stop event reaching PurrCode.
- No audible pop or abrupt cut on Tier 1 backends (see 11.3).
- The player process exits (or idles) after the fade.
- Repeated stop events are harmless.

### Interrupted, suspended, or crashed session

**As a user who pressed Esc, hit Ctrl+Z, or closed the terminal,** I want the purr to stop promptly even though no stop event fired.

Acceptance criteria:

- If the owning Claude Code process dies, playback fades out within 5 seconds (watchdog).
- If the owning Claude Code process is suspended (`SIGTSTP`/`SIGSTOP`), playback fades out within one watchdog cycle and fades back in when the process resumes with an active turn still registered.
- Sessions with no events for `staleSessionMinutes` (default 10) are garbage-collected.
- The next event from any session triggers full reconciliation.

### Multiple sessions

**As a user running several Claude Code terminals,** I want each active session tracked independently.

Acceptance criteria:

- Completing one session does not stop the purr while another is active.
- Playback stops only when the active-session count reaches zero.
- Duplicate start events from one session are idempotent (keyed by `session_id`).
- A start event arriving during a fade-out cancels the fade and resumes cleanly.

### Configuration

**As a user,** I want to adjust volume and purr style without editing JSON.

```bash
purrcode volume 15
purrcode sound sleepy
purrcode off
purrcode on
```

Changes apply to subsequent playback and to the currently playing loop (via the daemon control pipe).

### Uninstallation

**As a user,** I want to uninstall PurrCode without affecting unrelated Claude Code configuration.

Acceptance criteria:

- Plugin path: the plugin is disabled/removed; nothing else changes.
- Fallback path: only hook entries whose command string exactly matches a PurrCode-written command are removed; modified entries are reported, never deleted.
- Runtime state and the daemon are removed; user-imported audio is retained unless `--purge` is specified.

---

## 9. Functional Requirements

### FR-01: Plugin packaging (primary distribution)

PurrCode ships as a Claude Code plugin:

- Hooks are declared in the plugin's `hooks/hooks.json`; the user's `settings.json` is never modified.
- Scripts are referenced via `${CLAUDE_PLUGIN_ROOT}` in exec form, which resolves absolute paths across plugin updates.
- Persistent state (selected sound, volume, imported audio) lives in `${CLAUDE_PLUGIN_DATA}`, which survives plugin updates.
- `npx purrcode install` remains the front door: it registers the plugin (marketplace or local install) and verifies audio playback.
- Enable/disable maps to the plugin enable/disable mechanism where practical.

### FR-02: Direct hook installation (fallback)

For users who cannot or will not use plugins, `purrcode install --hooks` writes hooks into `~/.claude/settings.json`. The installer must:

1. Parse existing JSON safely; never overwrite invalid JSON (stop, show the parse location, leave the file untouched, suggest a fix).
2. Create the file if absent.
3. Write hooks in **exec form with absolute paths** (see Section 15) — never a bare `purrcode` command that depends on PATH, and never `npx`.
4. Detect an existing PurrCode installation and avoid duplicate handlers.
5. Write atomically (temp file + rename) and create a timestamped backup.
6. Preserve unrelated keys and hooks byte-for-byte where possible.
7. Record the exact command strings written, so uninstall can identify PurrCode-owned entries by exact match.

### FR-03: Start playback

The `UserPromptSubmit` hook handler must:

1. Read hook JSON from stdin; treat it as untrusted.
2. Extract `session_id`.
3. Capture the Claude Code process PID (the hook's parent at spawn time) for the watchdog.
4. Send a `start` message to the player daemon, spawning the daemon (fully detached: new session, stdio ignored) if absent.
5. Print nothing to stdout (stdout is injected into Claude's context on this event) and exit 0 in all circumstances.

The hook is configured with `async: true`, so even a slow cold start cannot delay the prompt.

### FR-04: Stop playback

`Stop`, `StopFailure`, and `SessionEnd` handlers send the corresponding message (`stop`, `failure`, `session-end`) with the `session_id`. Each is idempotent, exits 0, and prints nothing.

### FR-05: Player daemon and session registry

A single per-user player daemon owns audio and session state, serializing all concurrency:

- **Control pipe:** Unix domain socket (macOS/Linux) or named pipe (Windows) inside the runtime directory; the pipe/socket name embeds the user's UID (Unix) or SID/username (Windows) to avoid collisions on multi-user hosts. Hooks and the CLI are thin message senders. Loopback UDP/TCP is deliberately **not** used as the default transport: an unauthenticated localhost port would let any local process (or other user on a shared host) send `start`/`stop`/`volume` commands to the daemon, violating the minimal-trust model, whereas UDS and named pipes provide filesystem ACLs and OS peer credentials for free. The channel must be duplex in any case (`status` and `volume` are request/response).
- **Registry (in daemon memory, snapshotted to disk):**

```json
{
  "activeSessions": {
    "<session-id>": {
      "startedAt": "2026-07-17T13:00:00Z",
      "lastSeenAt": "2026-07-17T13:00:00Z",
      "claudePid": 12345
    }
  },
  "player": { "state": "playing | fading-out | idle" }
}
```

- **Watchdog (state-aware):** every 2–5 s, the daemon checks each session's `claudePid` for both **existence and run state**. A dead PID removes the session. A **suspended** process (Linux: state `T` in `/proc/[pid]/stat`; macOS: `ps -o state= -p <pid>` reporting `T`) is alive but frozen — Ctrl+Z emits no `Stop` event — so its session is marked *paused*: playback fades out while it is the only active session and fades back in if the process returns to running with the turn still open. Windows has no common suspend equivalent; existence-only checks apply there. When the active (non-paused) set reaches zero, fade out.
- **Daemon lifecycle:** on boot, the activity clock is initialized to *now*, and the daemon **never evaluates idle-exit while any client connection is open** — the spawning hook connects before sending its first message, which structurally eliminates the race where a freshly spawned daemon sees zero sessions and exits before the `start` message arrives. Idle-exit requires: zero sessions, zero open connections, and the grace period elapsed.
- **Stale TTL:** sessions with no events for `staleSessionMinutes` (default **10**) are removed.
- **Playback state machine:** `idle → fading-in → playing → fading-out → idle`, with `fading-out + start ⇒ cancel fade, resume`. This is the explicit fix for the start-during-fade race.
- **Daemon-spawn race:** if two hooks race to spawn the daemon, socket binding is the mutex — the loser detects the live socket and becomes a client.
- **Corruption:** an unreadable snapshot triggers safe regeneration, never hook failure.

Runtime directory (sockets, snapshot, daemon pidfile):

| Platform | Location |
|---|---|
| Linux | `$XDG_RUNTIME_DIR/purrcode/` preferred; `/tmp/purrcode-$UID/` fallback |
| macOS | `$TMPDIR/purrcode/` |
| Windows | `%LOCALAPPDATA%\PurrCode\runtime\` |

Creation must be hardened: `mkdir` with mode `0700`, then `lstat` verification that the path is a directory (not a symlink) owned by the current user; refuse to use it otherwise. This defends the predictable `/tmp` name against pre-creation and symlink attacks on shared hosts.

### FR-06: Audio engine

Capabilities: seamless looping, runtime volume control, fade-in, fade-out, graceful termination, bundled default sound, custom local audio files.

**Volume semantics:** the user-facing `0–100` scale is perceptual, not linear amplitude. Human loudness perception is logarithmic; passing the raw integer to a linear gain multiplier makes 1→10 sound enormous and 60→100 nearly identical. The scale maps through a perceptual curve (e.g., a cubic taper or a ~60 dB range as `gain_dB = −60 + 0.6·v`, with 0 = mute). The mapping lives **inside each audio-backend adapter**, not once in the daemon: tier-2 `mpv` already applies its own perceptual curve to its volume property, and applying ours on top would double it. Fade-in/out ramps interpolate in the perceptual domain for the same reason.

Input formats: **OGG and WAV** for bundled and imported audio. MP3 import is accepted with a documented warning: encoder padding makes MP3 loops audibly gapped; PurrCode does not attempt to repair them. Regardless of input format, every sound is also rendered to a canonical WAV in the data directory (see FR-08) so degraded backends never depend on native codec support.

Default settings:

```json
{
  "enabled": true,
  "sound": "sleepy",
  "volume": 20,
  "fadeInMs": 400,
  "fadeOutMs": 600,
  "staleSessionMinutes": 10
}
```

The configuration file carries a `schemaVersion` field from v0.1.0 onward to enable forward migration.

### FR-07: Bundled sounds

| Preset | Description |
|---|---|
| `sleepy` | Soft, steady, unobtrusive default |
| `kitten` | Higher-pitched and lighter |
| `diesel` | Deep, aggressively productive purr |
| `debugger` | Slightly irregular "concerned cat" purr |

All bundled audio must be original, public-domain, or CC0 (or otherwise redistribution-compatible), delivered as gapless OGG or WAV loops, with source and license documented per file. Mono is preferred to reduce package size.

### FR-08: Custom sound import

```bash
purrcode sound add my-cat ~/audio/purr.ogg
purrcode sound use my-cat
purrcode sound remove my-cat
```

The import command must: verify the file exists; validate format by **magic bytes, not extension**; sanitize the sound name (allowlist `[a-z0-9-]`, length cap); copy the file into PurrCode's data directory (never reference the original); reject files above a documented size limit (default 10 MB); and never upload anything.

**Canonical WAV cache:** at import time (and at install time for bundled sounds), the tier-1 sidecar transcodes each sound once to a WAV stored alongside the original in the data directory. Tier-1 playback uses the original; **tier-2/3 backends always play the WAV**. Rationale: native players are format-unreliable — `afplay` has no Vorbis codec and cannot play OGG at all, `aplay` is PCM/WAV-only, and `paplay`'s OGG support depends on the local libsndfile build. Caching a WAV removes the failure class instead of warning about it; `doctor` reports the active tier's capabilities rather than per-file format hazards.

### FR-09: CLI commands

```text
purrcode install [--hooks]
purrcode uninstall [--purge]
purrcode on | off
purrcode status
purrcode volume <0-100>
purrcode sound list | use <name> | add <name> <path> | remove <name>
purrcode preview [name]
purrcode doctor
purrcode hook <event>        # internal, invoked by Claude Code
```

Optional aliases: `mute`, `unmute`, `pspsps`. `pspsps` previews the selected purr. It is objectively unnecessary and therefore mandatory before version 1.0.

### FR-10: Diagnostic command

`purrcode doctor` must check:

- Claude Code installation and version
- Installation mode (plugin vs direct hooks) and hook presence/duplication
- Settings/plugin file validity
- **`disableAllHooks` in any settings scope** (purr silently disabled)
- CI / remote environment detection state (see 16)
- Audio backend tier in use and its capabilities
- Write access to configuration and runtime directories, including runtime-dir ownership checks
- Daemon health, socket reachability, registry validity, and any paused (suspended-owner) sessions
- Selected sound-file integrity
- Platform support

```text
PurrCode Doctor

✓ Claude Code detected (v2.1.x)
✓ Plugin installed and enabled
✓ Audio backend: bundled player (tier 1 — full fades)
✓ Default purr found
✓ Runtime directory writable and owned by you
! One stale session removed

The cat appears healthy.
```

### FR-11: Logging

Debug logging is disabled by default; enabled via `PURRCODE_LOG=debug`.

Logs may contain: event type, timestamp, hashed session ID, process IDs, selected sound, playback errors.

Logs must never contain: prompt text, assistant responses, tool inputs, repository file contents, environment-variable values, or credentials.

---

## 10. Waiting-for-Attention Behavior

Claude may pause for a permission request while a turn remains open. The MVP continues purring during these pauses.

A post-MVP experimental mode (`purrcode attention-mode pause`) may fade out on `PermissionRequest` / `Notification (permission_prompt)` and fade back in on `PostToolUse` / `PostToolUseFailure`. These events exist in the current hooks reference, but the pause/resume state machine has edge cases and is explicitly excluded from the MVP.

---

## 11. Technical Architecture

### 11.1 Recommended stack

TypeScript on Node.js 20+, distributed via npm, pnpm for development, Vitest, ESLint, Prettier, GitHub Actions CI, Changesets for releases. Rationale: `npx` install flow, straightforward JSON handling, mature cross-platform process APIs, low contributor barrier. Optional platform-specific audio sidecars may be written in Rust or C (see 11.3) and shipped as prebuilt binaries via npm `optionalDependencies`.

### 11.2 Components

```text
┌──────────────────────────────┐
│ Claude Code                  │
│ UserPromptSubmit / Stop /    │
│ StopFailure / SessionEnd     │
└──────────────┬───────────────┘
               │ stdin JSON (async hooks, exec form)
               ▼
┌──────────────────────────────┐
│ Hook Adapter (transient)     │
│ parse event · session_id ·   │
│ capture Claude PID · send    │
│ message · exit 0 · no stdout │
└──────────────┬───────────────┘
               │ UDS / named pipe
               ▼
┌──────────────────────────────┐
│ Player Daemon (per user)     │
│ session registry · watchdog  │
│ TTL cleanup · state machine  │
│ (idle/fade-in/play/fade-out) │
└──────────────┬───────────────┘
               ▼
┌──────────────────────────────┐
│ Audio Backend (tiered)       │
│ loop · volume · fades        │
└──────────────────────────────┘
```

The daemon is the single serialization point: no cross-process file locking is needed for normal operation, runtime volume changes have a live target, and the fade/restart race is handled in one state machine.

### 11.3 Audio backend tiers

| Tier | Backend | Loop | Fade in/out | Runtime volume | Notes |
|---|---|---|---|---|---|
| 1 (default) | Bundled tiny player binary (miniaudio/rodio based), shipped per-platform via `optionalDependencies` | ✓ gapless | ✓ | ✓ | esbuild-style distribution; no postinstall scripts; a few hundred KB |
| 2 | `mpv` with IPC socket, if present | ✓ | ✓ (via volume property) | ✓ | Detected, never required |
| 3 (degraded) | `afplay` / `paplay` / `aplay` / PowerShell playback | respawn (seamed) | ✗ hard stop | ✗ | Honest degradation, reported by `doctor`; always plays the canonical WAV cache (FR-08) |

Rationale: no native OS player supports runtime fade-out, which must happen at stop time and cannot be baked into the asset. FFmpeg/`ffplay` is not required. WSL: prefer WSLg/PulseAudio when present; otherwise report degraded/unavailable via `doctor` (Phase 2).

Backend abstraction (each adapter owns the perceptual→amplitude volume mapping for its player — see FR-06):

```ts
interface AudioBackend {
  detect(): Promise<BackendCapabilities>;
  play(options: PlaybackOptions): Promise<PlayerHandle>;
  setVolume?(handle: PlayerHandle, volume: number): Promise<void>;
  stop(handle: PlayerHandle, fadeOutMs: number): Promise<void>;
}
```

---

## 12. Reliability Requirements

### RR-01: Non-blocking operation

All hooks are configured `async: true`, so Claude Code never waits on PurrCode. Hook handlers must still exit within 2 seconds under normal conditions and carry a hook `timeout` of 5 (seconds) as a hard backstop.

### RR-02: Fail open and fail silent

If PurrCode fails: Claude Code continues normally; hooks exit 0; errors go only to the debug log; nothing is printed to stdout or stderr (a non-zero exit or stderr output can surface a hook-error notice in the transcript, which violates the invisibility goal).

### RR-03: Idempotency

Safe when repeated: install, start, stop, session cleanup, uninstall, stale-process cleanup, daemon spawn.

### RR-04: Abandoned-turn recovery

Because a stop event is not guaranteed (user interrupt, terminal kill, crash), the daemon must:

1. Watchdog each session's `claudePid` for existence **and run state**: fade out within 5 s of owner death, and within one watchdog cycle of owner suspension (`SIGTSTP`/`SIGSTOP`); resume playback if a suspended owner returns to running with its turn still open.
2. Expire sessions after `staleSessionMinutes` (default 10) without events.
3. Reconcile the full registry on every incoming event.
4. On daemon start, discard any stale snapshot state that fails liveness checks.

### RR-05: Concurrency

Correct under: simultaneous Claude sessions; parallel hook invocations; rapid prompt submission; terminal closure during playback; stop and start arriving close together; **start arriving mid-fade-out** (cancel fade, resume); **two hooks racing to spawn the daemon** (socket bind as mutex).

---

## 13. Security and Privacy

Minimal-trust model:

- No network requests at runtime; installation may contact the npm registry only.
- No analytics or telemetry; no reading of transcripts; no storage of prompt content.
- Hook stdin is untrusted JSON: schema-validate, cap size, never interpolate its fields into shell commands or file paths.
- No `eval`; all child processes launched with argument arrays (exec form), never shell-interpolated strings.
- **Hook commands written by the installer use exec form with absolute paths and never rely on PATH or `npx`** — this is both a reliability and a supply-chain measure (no ad-hoc package resolution on every prompt).
- Imported sound names sanitized (allowlist); imported files validated by magic bytes and size-capped.
- Runtime directory created `0700` and `lstat`-verified (owner, non-symlink) before use.
- Configuration writes are atomic and refuse to follow unexpected symlinks.
- Uninstall identifies PurrCode-owned hook entries by exact command-string match; anything modified is reported, not deleted.
- Audio processes run with the current user's privileges only.

Supply-chain controls: committed lockfile; Renovate/Dependabot; npm provenance on releases; GitHub Actions pinned to immutable commit SHAs; minimal runtime dependencies; automated dependency and secret scanning; reproducible, documented release procedure; prebuilt sidecar binaries built in CI from source with published checksums.

---

## 14. Installation Design

```bash
npx purrcode install          # plugin path (default)
npm i -g purrcode && purrcode install
purrcode install --hooks      # direct-hook fallback
```

```text
🐈 Installing PurrCode

✓ Detected Claude Code
✓ Installed PurrCode plugin
✓ Installed default purr
✓ Verified audio playback (tier 1)

Claude will now purr while working.

Try it:            purrcode preview
Adjust volume:     purrcode volume 15
```

The direct-hook fallback never silently overwrites invalid JSON: it stops, displays the parse location, leaves the original untouched, and suggests a repair path.

---

## 15. Hook Configuration

Illustrative plugin `hooks/hooks.json` (the fallback installer writes the same shape into `~/.claude/settings.json` with resolved absolute paths instead of `${CLAUDE_PLUGIN_ROOT}`):

```json
{
  "description": "PurrCode: Claude purrs while working",
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node",
            "args": ["${CLAUDE_PLUGIN_ROOT}/dist/hook.js", "start"],
            "async": true,
            "timeout": 5
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node",
            "args": ["${CLAUDE_PLUGIN_ROOT}/dist/hook.js", "stop"],
            "async": true,
            "timeout": 5
          }
        ]
      }
    ],
    "StopFailure": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node",
            "args": ["${CLAUDE_PLUGIN_ROOT}/dist/hook.js", "failure"],
            "async": true,
            "timeout": 5
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node",
            "args": ["${CLAUDE_PLUGIN_ROOT}/dist/hook.js", "session-end"],
            "async": true,
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

Design notes:

- **Exec form** (`command` + `args`): no shell, no quoting issues, works with `.js` entrypoints on Windows where npm `.cmd` shims cannot be spawned directly.
- **No `matcher` fields**: `UserPromptSubmit` and `Stop` do not support matchers (the field is silently ignored); omitting it everywhere keeps the config honest.
- **`async: true`** on every hook: Claude Code never blocks on PurrCode.
- Exact schema re-validated against the shipped Claude Code version during Phase 0.

---

## 16. UX Requirements

### Audio quality

Default purr loops without an audible seam; default volume is subtle; no clipping; no sudden playback at 100%; fades avoid pops (tier 1); mono preferred for package size.

### CLI personality

Playful but informative. Good: `✓ No stray cats found`. Bad: `Something went meowrong!!!`. Errors must explain what happened and how to fix it.

### Environment awareness

- Disabled automatically when `CI` is set or when `CLAUDE_CODE_REMOTE=true` (remote web environments). Hooks run without a controlling terminal, so TTY checks are not a valid detection mechanism — use environment variables only.
- Headless `-p` behavior is a Phase 0 spike item.

### Accessibility

All controls work through text commands; no functionality depends solely on emoji or color; `NO_COLOR` respected; output readable in screen readers and plain logs.

---

## 17. Success Metrics

No telemetry; health is measured through public and opt-in indicators.

**Adoption:** GitHub stars, npm weekly downloads, unique contributors, release downloads, third-party sound contributions.

**Quality:** installation success across the platform matrix, open bug count, median issue-resolution time, percentage of reported bugs reproducible in CI, regressions involving orphaned audio processes, OpenSSF Scorecard score (target ≥ 7.0 from v0.5.0).

**90-day directional targets:** 500 GitHub stars; 1,000 npm downloads; ≥5 external contributors; zero known critical process-leak bugs; green CI on all supported operating systems.

---

## 18. Testing Strategy

### Unit tests

Settings merge logic (fallback path); hook deduplication; session registry semantics; PID validation and **process-state classification (running/suspended/dead) per platform**; stale-session cleanup; watchdog logic; **perceptual volume-curve mapping per backend adapter (monotonic, 0 = mute, no double-application on mpv)**; configuration validation and `schemaVersion` migration; sound-name sanitization; magic-byte format validation; **WAV-cache generation at import**; platform detection; registry-snapshot corruption recovery; playback state machine transitions (including fade-out → start and pause/resume on suspend).

### Integration tests

Start → Stop; Start → StopFailure; Start → SessionEnd; two sessions → one stop → final stop; duplicate start from one session; **start during fade-out**; **daemon-spawn race** (parallel first events); **cold-boot idle-exit guard** (daemon spawned, message delayed — must not self-terminate); **owner-PID death with no stop event** (watchdog path); **owner suspended with Ctrl+Z → purr pauses; `fg` → purr resumes**; missing audio backend (tier fallback **plays the WAV cache**); player crash during active session; invalid Claude settings (fallback installer); uninstall with unrelated and with user-modified hooks present; CI/remote env-var suppression.

### Platform matrix

macOS arm64/x64; Ubuntu x64 (arm64 where available); Windows x64; WSL2 x64.

### Manual audio tests

Every bundled sound checked for: seam audibility, pops, volume consistency, listener fatigue over 15 minutes, fade quality, headphone and speaker playback.

---

## 19. Release Plan

### Phase 0: Technical spike

Deliverables:

- Confirm hook payloads and `session_id` stability across target Claude Code versions.
- **Determine whether Esc-interrupt fires `Stop`** (design assumes it may not).
- Confirm the hook process's parent PID reliably identifies the owning Claude Code process; select an alternative liveness signal if not.
- Validate **process-state detection** (`/proc/[pid]/stat` on Linux, `ps -o state=` on macOS) at watchdog cadence, including suspend → resume round-trips.
- Verify **Windows named-pipe interop** between elevated and non-elevated prompts, and under restrictive enterprise ACLs; document the failure mode if blocked.
- Validate plugin packaging, `${CLAUDE_PLUGIN_ROOT}` exec-form invocation, and `async: true` behavior on all platforms.
- Validate fully detached daemon spawn on macOS, Linux, and Windows.
- Select/build the tier-1 audio sidecar; verify gapless loop + fades on all platforms.
- Verify headless `-p` mode behavior.
- Test two simultaneous Claude sessions.

Exit criteria: no orphaned player after normal stop, interrupt, or terminal kill; multi-session refcounting correct; prototype passes on macOS, Linux, and Windows.

### Phase 1: MVP — v0.1.0

Plugin install/uninstall; one default purr; start/stop/failure/session cleanup; watchdog + TTL reconciliation; volume control; on/off; status; doctor; macOS, Linux, Windows. **OSS surface:** community health files (23.1), `AGENTS.md` + `CLAUDE.md`, fake audio backend, DCO check, fork-PR CI security rules (23.3), branch protection.

### Phase 2: Public beta — v0.5.0

Four bundled purrs; custom sound import; direct-hook fallback installer; WSL support; improved fades; automated npm releases with provenance; contributor documentation. **OSS surface:** sound-submission lane live (23.4), Scorecard action + badge with score ≥ 7.0, CodeQL, issue/PR templates hardened from real triage.

### Phase 3: Stable — v1.0.0

Stable configuration schema (`schemaVersion` + migrations); backward-compatible CLI; complete platform matrix; audio asset licensing audit; security review; migration and uninstall guarantees; documented support policy; `purrcode pspsps`. **OSS surface:** OpenSSF Best Practices badge (passing tier), ≥2 co-maintainers, governance documented.

### Future possibilities

Attention-mode pause on permission requests; per-project purr profiles; purr intensity by concurrent tool calls; subagent kitten sounds; status-line indicator; other agents (Codex, Gemini CLI); community purr gallery.

---

## 20. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Esc/interrupt produces no stop event | High | PID watchdog (≤5 s), 10-min TTL, per-event reconciliation; spike verifies actual behavior |
| Ctrl+Z suspends Claude without killing it → infinite purr at a shell prompt | Medium | State-aware watchdog treats `T`-state processes as paused; fade out on suspend, resume on `fg` |
| Windows named-pipe ACLs block hook↔daemon messaging in enterprise/elevated contexts | Medium | Phase 0 interop spike; per-user pipe naming; documented fallback (loopback TCP with a 0600 secret token) as a last-resort tier — never unauthenticated UDP |
| Hook command fails to resolve → visible transcript errors every prompt | High | Exec form, absolute paths / `${CLAUDE_PLUGIN_ROOT}`, no PATH or `npx` reliance; doctor verifies resolution |
| Native audio players cannot fade or loop gaplessly | High | Tier-1 bundled sidecar; honest tier-3 degradation surfaced in `doctor` |
| Multiple sessions corrupt shared state | High | Single daemon as serialization point; socket-bind spawn mutex; state machine |
| Installer damages settings | Was Critical → Low | Plugin-first distribution removes settings surgery from the default path; fallback keeps atomic writes + backups |
| Hook lifecycle imperfectly represents "thinking" | Medium | Explicit active-turn semantics (Section 7) |
| Purr loop becomes annoying | Medium | Low default volume, instant mute, configurable sound |
| Prebuilt sidecar binaries raise trust concerns | Medium | Built in CI from source, checksummed, npm provenance, optionalDependencies (no postinstall) |
| Audio asset licensing unclear | High | Original/CC0 recordings with documented provenance; v1.0 licensing audit |
| Package name conflicts / trademark | Medium | Registry + trademark check before release; no "Claude" in package name |
| Feature bloat | Medium | Non-goals enforced through contribution guidelines |
| High volume of unverified AI-generated PRs/issues consumes maintainer attention | Medium | AI contribution policy (23.5): disclosure checkbox, submitter accountability, fast-close for untested bulk submissions, templates requiring `doctor` output |
| Fork-PR workflow compromise exfiltrates secrets or poisons releases | High | `pull_request` trigger only, zero secrets in PR workflows, least-privilege permissions, SHA-pinned actions, publish behind protected environment (23.3) |

---

## 21. Open Questions

Resolved since v0.1:

- ~~Stable identifier~~ → `session_id`, documented on every hook event.
- ~~One shared purr vs per-session layers~~ → one shared purr while ≥1 session is active.
- ~~Copy vs symlink imports~~ → copy into the data directory.
- ~~Direct hooks vs plugin~~ → plugin-first; direct hooks as fallback.
- ~~Bundled executable acceptable?~~ → yes, as tier 1, with CI-built provenance; native tools remain as degraded fallback.

Still open (Phase 0):

1. Does Esc-interrupt fire `Stop` on current Claude Code versions?
2. Is the hook's parent PID a reliable handle on the owning Claude Code process on all platforms, given hooks run in their own session?
3. What is the best suppression signal for headless `-p` runs?
4. WSL without WSLg/PulseAudio: degrade silently or attempt a Windows-host bridge? (Leaning: degrade + `doctor` notice.)
5. Final npm package name, verified distinct from `claude-purr`.

---

## 22. Definition of Done for MVP

- A new user installs PurrCode with one command; `settings.json` is untouched on the default path.
- Purring starts after prompt submission and stops after successful turns, failed turns, **and abandoned turns** (interrupt/terminal kill) within watchdog bounds; it pauses while the owning process is suspended and resumes on `fg`.
- No hook-error notices, context injection, or prompt delays are ever observable in Claude Code.
- Two simultaneous sessions are handled correctly; no permanent orphaned audio in any tested failure mode.
- Existing Claude Code configuration survives installation and removal unchanged.
- Works on macOS, Ubuntu, and Windows (WSL in Phase 2).
- No prompts, responses, transcripts, or repository contents are read or stored.
- All bundled audio has verified redistribution rights.
- CI passes the full test matrix, including the fake-audio integration suite.
- Community health files, `AGENTS.md`, DCO enforcement, and fork-PR CI security rules are in place.
- README covers installation, uninstallation, architecture, privacy, troubleshooting, and contribution.

---

## 23. Open Source Operations

"Easy for first-time contributors" is a requirement, not a vibe. This section defines the contribution surface for humans and AI agents alike.

### 23.1 Community health files (Phase 1 deliverables)

| File | Content |
|---|---|
| `README.md` | Install, uninstall, architecture sketch, privacy statement, troubleshooting, badges (CI, npm, Scorecard) |
| `CONTRIBUTING.md` | Dev setup (`pnpm install`, `pnpm test`, `pnpm e2e:fake-audio`), how to test hooks against a local Claude Code, PR expectations, DCO instructions |
| `CODE_OF_CONDUCT.md` | Contributor Covenant, with a named enforcement contact |
| `SECURITY.md` | Private disclosure via GitHub Security Advisories; acknowledgment within 7 days; no public PoC before a fix ships |
| `AGENTS.md` | Canonical agent context file (see 23.5) |
| `CLAUDE.md` | One line: points to `AGENTS.md` (single source of truth, no per-tool drift) |
| `.github/` templates | Bug report (requires `purrcode doctor` output + OS/tier), feature request (must address non-goals), **sound submission** (see 23.4), PR template with test + licensing checklist |
| `CODEOWNERS` | Maintainer review required on `hooks/`, release workflows, and `sounds/` |
| `ASSETS.md` | Per-file audio provenance and license ledger |

### 23.2 Contribution workflow

- **DCO, not CLA.** `Signed-off-by` via `git commit -s`, enforced by a DCO check. Low friction fits a toy-sized project; MIT + DCO is sufficient.
- **Changesets required** on user-facing changes; semver is enforced against the CLI surface and `schemaVersion` (breaking either requires a major).
- **Branch protection** on `main`: required CI matrix, required review, squash merge, linear history.
- `good first issue` and `help wanted` labels maintained deliberately; the four bundled-sound slots and doctor checks are natural first issues.
- Scope discipline: PRs expanding into Section 5 non-goals are closed with a pointer to the PRD, kindly.

### 23.3 CI security for fork PRs

Fork PRs are untrusted code. Rules:

- Fork PRs run only on the `pull_request` trigger. **`pull_request_target` combined with a checkout of fork code is banned** in this repository — it is the classic secret-exfiltration pattern.
- PR workflows have access to zero secrets; top-level `permissions: {contents: read}` with least-privilege per job.
- All actions pinned to immutable commit SHAs (already in Section 13); Renovate keeps pins current.
- npm publish runs only from tags on `main`, behind a **protected `release` environment** with provenance enabled; no PR-triggered workflow can reach it.
- OpenSSF **Scorecard action** runs on `main` with the badge in the README; CodeQL enabled. Target: Scorecard ≥ 7.0 by v0.5.0, OpenSSF **Best Practices badge (passing tier)** by v1.0.0.

### 23.4 Sound contribution policy

Audio is the highest-licensing-risk PR type, so it gets its own lane:

- Accepted licenses: **CC0 or original work only** — no CC-BY (attribution tracking burden), no scraped or "found" audio, no AI-generated purrs (Section 5 non-goal, and provenance is unverifiable).
- The sound-submission template requires a provenance statement: who recorded it, where, on what, and an explicit CC0 dedication or ownership declaration by the submitter.
- Every audio PR updates `ASSETS.md` in the same commit; a CI check enforces that `sounds/` changes touch the ledger.
- Technical gate: mono OGG or WAV source, loop-point QA per Section 18's manual audio tests, size cap enforced in CI.
- Merged by a human maintainer only, after actually listening to it. The cat must be heard to be believed.

### 23.5 AI-agent contributor support

PurrCode expects a meaningful share of contributions to arrive via coding agents (Claude Code, Codex, Copilot, Cursor, and similar) and treats that as a supported path, not an accident.

**Repo context:** an `AGENTS.md` at the repository root — the Linux Foundation (AAIF)-stewarded standard most agent tools read — containing: exact build/lint/test/e2e commands with flags; an architecture map (hook adapter → daemon → backend tiers); hard constraints (no new runtime dependencies without a linked issue, no network code anywhere, never modify release workflows or `sounds/` licensing files, all child processes in exec form); and how to verify changes headlessly. `CLAUDE.md` simply references `AGENTS.md` so there is one source of truth.

**Agent-verifiable testing:** a **fake audio backend** (`PURRCODE_FAKE_AUDIO=1`) implements the `AudioBackend` interface by writing playback events (start/volume/fade/stop with timestamps) to a log instead of a sound card. The full integration suite runs against it, so an agent — or a contributor without speakers, or CI itself — can verify loop/fade/refcount logic deterministically. Perceptual audio QA remains human-only (Section 18).

**AI-assisted contribution policy** (stated in `CONTRIBUTING.md`, modeled on emerging community policies such as rOpenSci's):

- AI-assisted and agent-authored PRs are welcome. The human submitter remains fully responsible for the contribution: they must understand it, have run the tests, and be able to discuss it in review.
- Substantially agent-generated work is disclosed in the PR description (a checkbox in the template).
- Unverified bulk submissions — PRs or bug reports that were clearly not tested or read by their submitter — are closed without extended triage. Review attention is the project's scarcest resource.
- Agents may not contribute audio assets (23.4 requires human provenance) and may not sign the DCO on a human's behalf — the sign-off is the human's legal attestation.

### 23.6 Governance

- Single-maintainer (BDFL) model at launch, stated plainly in `CONTRIBUTING.md`; commit bit offered after a track record of sustained, quality contributions (target: ≥2 co-maintainers by v1.0, which also satisfies bus-factor expectations).
- Decisions happen in public issues; the PRD lives in the repo and is the roadmap; amendments to it are PRs like everything else.
- If the project is abandoned, the README commits to archiving the repo rather than leaving it ambiguous, and npm deprecation messaging points to any successor.

---

## 24. Product Principle

> PurrCode should be funny when discovered, invisible when working, and boringly reliable underneath.

The joke earns the install. Engineering quality keeps it installed.
