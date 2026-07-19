# PC-003 spike — control-pipe transport

Throwaway prototypes and evidence for PC-003. Findings and decisions live in
[docs/decisions/0003-control-pipe-transport.md](../../docs/decisions/0003-control-pipe-transport.md).

Tested: Linux (Ubuntu, kernel 6.17), Node v20.20.2; macOS arm64 (2026-07-19).
Windows still unpaid — the Windows prototype is written and ready to execute
(`win32-named-pipe.mjs`).

## Files

- `daemon.mjs` — prototype daemon: binds a UDS in a 0700 per-user runtime
  dir, newline-delimited JSON request/response, **bind-as-mutex** (EADDRINUSE
  + live probe → lose race and exit; + dead probe → reclaim stale socket),
  idle-exit that never fires while a connection is open (FR-05 rule).
- `run-scenarios.mjs` — scenario driver; writes `evidence/pc003-events.jsonl`.
- `win32-named-pipe.mjs` — Windows named-pipe variant (per-SID naming,
  elevated↔non-elevated interop instructions). **Not yet run.**

Run: `node run-scenarios.mjs` (no external services needed).

## Results (Linux)

| Scenario | Result |
|---|---|
| UDS echo round-trip | p50 0.023 ms, p95 0.084 ms over 50 pings |
| Per-UID naming + permissions | dir `0700`, socket `0600`, owned by uid, under `$XDG_RUNTIME_DIR` |
| Detached spawn | own session (sid ≠ spawner's), `stdio: ignore`, survives spawner exit |
| Cold-start sequencing | client connect-with-retry succeeded on attempt 2, 26 ms after spawn; first message served |
| Bind-as-mutex | second daemon exits 0 with `lost-race` |
| Stale socket (SIGKILL'd owner) | next daemon reclaims (`unlink` + rebind) and serves; client reconnects on attempt 1 |
| Idle-exit rule | daemon with 1.5 s idle timeout survived a 4 s held connection, exited 1.6 s after close |

Known prototype quirk: the reclaim path logs `listening` twice (both the
original and retried `listen()` resolve after the unlink); harmless here,
worth avoiding in the real daemon (PC-104).

## Results (macOS arm64)

Evidence: `evidence/macos-20260719/run-scenarios.stdout` (from `run-scenarios.mjs`).

| Scenario | Result |
|---|---|
| UDS echo round-trip | p50 0.028 ms, p95 0.214 ms over 50 pings |
| Per-UID naming + permissions | dir `0700`, socket `0600`, under `$TMPDIR` |
| Detached spawn | `survives_parent_exit: true`; BSD `ps sess=` often reports `0`/`0` so `newSession` may be false even when detach works |
| Cold-start sequencing | 4 attempts, 79 ms |
| Bind-as-mutex / stale socket / idle-exit | same as Linux |

`run-scenarios.mjs` uses `ps -o sess=` on darwin (Linux `sid=` is invalid on BSD).
