# 0003 — Control-pipe transport (UDS verified on Linux + macOS; Windows designed, unverified)

- **Status:** Accepted — Linux + macOS UDS verified (2026-07-19); Windows named-pipe unpaid
- **Date:** 2026-07-18 (macOS rerun 2026-07-19)
- **Story:** PC-003
- **macOS evidence:** [macos-rerun-20260719.md](../planning/reviews/macos-rerun-20260719.md) · `spikes/pc-003-control-pipe/evidence/macos-20260719/`
- **PRD refs:** FR-05 / §20 row 3 / §13 (runtime dir hardening)

## Question

Does the UDS/named-pipe transport work from Node 20+ with per-user naming and
hardened permissions? Is the Windows-ACL risk (§20 row 3) retired or does the
loopback-TCP fallback need to be in MVP? Does fully-detached daemon spawn
survive parent exit, and does cold-start sequencing (client connects before
first message, daemon never idle-exits with an open connection) hold?

## Evidence

Linux (Ubuntu, kernel 6.17.0-40), Node v20.20.2. Prototype daemon + scenario
driver and raw JSONL in
[`spikes/pc-003-control-pipe/`](../../spikes/pc-003-control-pipe/README.md).
**macOS arm64 verified 2026-07-19** under `$TMPDIR` (`/var/folders/...`): all
UDS scenarios green. Harness note: BSD `ps` uses `sess=` (not Linux `sid=`);
`sess` may report `0`/`0` so `newSession` is unreliable — rely on
`survives_parent_exit`. **Windows still unpaid.** Linux numbers below are from
`evidence/pc003-events.jsonl`.

1. **UDS request/response works and is fast**: newline-delimited JSON echo
   round-trip p50 0.023 ms / p95 0.084 ms — three orders of magnitude inside
   the hook's 5 s timeout budget.
2. **Per-UID naming + hardening**: socket lives in
   `$XDG_RUNTIME_DIR/purrcode-<uid>/` created `0700` and `lstat`-verified
   (owner, dir, no group/other bits) before bind; socket chmod `0600`.
3. **Detached spawn**: `spawn(..., {detached: true, stdio: "ignore"})` +
   `unref()` gives the daemon its own session (verified sid ≠ spawner sid)
   and it survives spawner exit (verified alive 1 s after the spawner died).
4. **Cold-start sequencing**: a client that spawns the daemon and immediately
   connect-retries (25 ms backoff) connected on attempt 2, 26 ms after spawn —
   no readiness handshake needed, though the prototype also supports a
   ready-FD if PC-104 wants one.
5. **Bind-as-mutex**: a second daemon racing for the same socket gets
   `EADDRINUSE`, probes the socket, finds a live owner, exits 0 (`lost-race`).
6. **Stale-socket recovery**: after SIGKILL of the owner the socket file
   remains; the next daemon's probe gets `ECONNREFUSED`, unlinks, rebinds and
   serves. Client reconnected on attempt 1.
7. **Idle-exit rule (FR-05)**: a daemon with a 1.5 s idle timeout survived a
   4 s held-open connection (still serving at the end), then exited 1.6 s
   after the connection closed. The rule "idle timer runs only at zero
   connections" is implemented and proven in the prototype.

## Decision

- **Transport is a per-user UDS** at `$XDG_RUNTIME_DIR/purrcode-<uid>/control.sock`
  (fallback base: `os.tmpdir()` when `XDG_RUNTIME_DIR` is unset, same 0700
  checks), newline-delimited JSON, `0700` dir + `0600` socket, `lstat`-verified
  before use. On Windows: `\\.\pipe\purrcode-<user SID>` via Node's `net`
  (same code path; no chmod/unlink — pipes are ACL'd and vanish with their
  last handle, so the stale-socket branch is Unix-only).
- **Spawn mutex is the socket bind** (EADDRINUSE → probe → lose-race exit or
  stale reclaim), exactly as PRD §20 row 6 assumed. No lockfiles.
- **Cold-start**: client-side connect-with-retry (~25 ms backoff, few-second
  cap) is sufficient and simplest; adopt for PC-103/PC-107.
- **Windows elevated↔non-elevated interop is *not* retired**: prototype
  (`win32-named-pipe.mjs`) is written with per-SID naming and an interop
  checklist, but needs a Windows machine. **Recommendation: the loopback-TCP
  fallback stays out of MVP** — worst plausible case is a hook in an elevated
  prompt failing to reach a non-elevated daemon, which fails silent (no purr,
  no error) and is acceptable degradation until proven otherwise.
- Rejected alternatives: lockfile-based spawn mutex (racy vs bind, needs
  cleanup); readiness handshake via ready-FD as the default (extra plumbing
  the retry loop makes unnecessary); unauthenticated UDP (banned by PRD).

## Consequences

- Backlog impact (flag for PC-009):
  - PC-102 (runtime dir): checks proven here (0700, lstat, per-UID) can be
    lifted directly.
  - PC-103 (control pipe): protocol shape (NDJSON request/response) and
    connect-retry policy decided; port the bind-as-mutex + stale-reclaim state
    machine from the prototype, fixing its double-`listening` log quirk.
  - PC-104 (daemon core): idle-exit implementation pattern (timer armed only
    at zero connections) is proven.
- PRD impact: none — §20 row 3 stays open pending the Windows rerun; the
  fallback remains documented-but-deferred.
- Follow-ups: run `win32-named-pipe.mjs` on Windows (normal↔normal,
  elevated↔non-elevated both directions).
