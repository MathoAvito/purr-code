#!/usr/bin/env node
/**
 * PC-006 throwaway prototype daemon: session refcounting + watchdog + fake
 * player. Combines the ADR 0002/0003 findings into the Phase 0 exit-criterion
 * prototype.
 *
 * Transport: UDS (per ADR 0003), NDJSON messages:
 *   {op:"start",       sessionId, pid, starttime}   -> turn active
 *   {op:"stop",        sessionId}                    -> turn ended
 *   {op:"session-end", sessionId}                    -> session gone
 *
 * Player is FAKE (PC-101 style): state changes are appended to the player
 * log with timestamps instead of touching a sound card:
 *   {player:"start"} when active turns go 0 -> >=1
 *   {player:"fade", ms:300} then {player:"stop"} when they go >=1 -> 0
 *
 * Watchdog (2 s cadence): every registered session's owning pid is checked
 * via (pid, starttime) — Linux /proc or macOS `ps` (ADR 0002). Gone/mismatched
 * -> the session is evicted as if it sent stop+session-end.
 *
 * Usage: node proto-daemon.mjs <socket> <player-log>
 */
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { statOf, isDead } = require("./process-liveness.cjs");

const SOCK = process.argv[2];
const PLAYER_LOG = process.argv[3];
const WATCHDOG_MS = 2000;
const IDLE_EXIT_MS = 8000;

fs.mkdirSync(path.dirname(SOCK), { recursive: true, mode: 0o700 });
fs.mkdirSync(path.dirname(PLAYER_LOG), { recursive: true });

const t0 = Date.now();
function plog(rec) {
  fs.appendFileSync(PLAYER_LOG, JSON.stringify({ t: (Date.now() - t0) / 1000, ...rec }) + "\n");
}

/* sessionId -> {pid, starttime, turnActive} */
const sessions = new Map();
let playing = false;

function activeTurns() {
  return [...sessions.values()].filter((s) => s.turnActive).length;
}

function reconcile(reason) {
  const n = activeTurns();
  if (n > 0 && !playing) {
    playing = true;
    plog({ player: "start", reason, activeTurns: n, sessions: sessions.size });
  } else if (n === 0 && playing) {
    playing = false;
    plog({ player: "fade", ms: 300, reason });
    plog({ player: "stop", reason, sessions: sessions.size });
  }
}

function handle(msg) {
  const { op, sessionId } = msg;
  if (op === "start") {
    sessions.set(sessionId, {
      pid: msg.pid,
      starttime: msg.starttime ?? statOf(msg.pid)?.starttime,
      turnActive: true,
    });
    plog({ event: "turn-start", sessionId: sessionId.slice(0, 8), pid: msg.pid });
  } else if (op === "stop") {
    const s = sessions.get(sessionId);
    if (s) s.turnActive = false;
    plog({ event: "turn-stop", sessionId: sessionId.slice(0, 8) });
  } else if (op === "session-end") {
    sessions.delete(sessionId);
    plog({ event: "session-end", sessionId: sessionId.slice(0, 8) });
  }
  reconcile(op);
}

let emptySince = Date.now();
setInterval(() => {
  for (const [sid, s] of sessions) {
    const st = statOf(s.pid);
    // dead = gone, recycled pid (starttime mismatch), or unreaped zombie
    if (isDead(st, s.starttime)) {
      sessions.delete(sid);
      plog({ event: "watchdog-evict", sessionId: sid.slice(0, 8), pid: s.pid, stat: st });
      reconcile("watchdog");
    }
  }
  if (sessions.size > 0 || playing) {
    emptySince = Date.now();
  } else if (Date.now() - emptySince > IDLE_EXIT_MS) {
    // FR-05 idle-exit: no sessions, nothing playing -> leave no orphan behind
    plog({ event: "daemon-idle-exit", pid: process.pid });
    try {
      fs.unlinkSync(SOCK);
    } catch {}
    process.exit(0);
  }
}, WATCHDOG_MS);

const server = net.createServer((conn) => {
  let buf = "";
  conn.on("data", (c) => {
    buf += c.toString("utf8");
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      try {
        handle(JSON.parse(line));
      } catch {}
    }
  });
  conn.on("error", () => {});
});
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") process.exit(0); // lost spawn race (ADR 0003)
  process.exit(4);
});
server.listen(SOCK, () => plog({ event: "daemon-listening", pid: process.pid }));
