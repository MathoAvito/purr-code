# PC-003 spike — control-pipe transport

Throwaway prototypes and evidence for PC-003. Findings and decisions live in
[docs/decisions/0003-control-pipe-transport.md](../../docs/decisions/0003-control-pipe-transport.md).

Tested: Linux (Ubuntu, kernel 6.17), Node v20.20.2. macOS and Windows were
**not** available — the Windows prototype is written and ready to execute at
the PC-009 platform rerun.

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
