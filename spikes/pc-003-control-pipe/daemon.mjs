#!/usr/bin/env node
/**
 * PC-003 throwaway prototype daemon.
 *
 * Demonstrates the FR-05-relevant transport behaviors on a UDS:
 *   - binds a socket inside a 0700 per-user runtime dir (per-UID naming)
 *   - socket bind is the spawn mutex: EADDRINUSE + live peer -> exit(0)
 *     (someone else won the race); EADDRINUSE + dead peer -> unlink stale
 *     socket and rebind
 *   - newline-delimited JSON request/response ({op:"ping"} -> {ok:true,...})
 *   - idle-exit after IDLE_MS, but NEVER while a connection is open
 *     (cold-start rule: an open connection pins the daemon alive)
 *
 * Usage: node daemon.mjs <socket-path> [idle-ms]
 */
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const SOCK = process.argv[2];
const IDLE_MS = Number(process.argv[3] ?? 3000);
if (!SOCK) {
  console.error("usage: daemon.mjs <socket-path> [idle-ms]");
  process.exit(2);
}

const dir = path.dirname(SOCK);
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const st = fs.lstatSync(dir);
if (st.uid !== process.getuid() || !st.isDirectory() || (st.mode & 0o077) !== 0) {
  console.error("runtime dir failed 0700/ownership check");
  process.exit(3);
}

let connections = 0;
let idleTimer = null;

function armIdleTimer() {
  clearTimeout(idleTimer);
  if (connections === 0) {
    idleTimer = setTimeout(() => {
      server.close(() => {
        try {
          fs.unlinkSync(SOCK);
        } catch {}
        process.exit(0);
      });
    }, IDLE_MS);
  }
}

const server = net.createServer((conn) => {
  connections += 1;
  clearTimeout(idleTimer); // an open connection pins the daemon alive
  let buf = "";
  conn.on("data", (chunk) => {
    buf += chunk.toString("utf8");
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        conn.write(JSON.stringify({ ok: false, error: "bad json" }) + "\n");
        continue;
      }
      conn.write(
        JSON.stringify({ ok: true, echo: msg, pid: process.pid, t: Date.now() }) + "\n",
      );
    }
  });
  conn.on("close", () => {
    connections -= 1;
    armIdleTimer();
  });
  conn.on("error", () => {});
});

function bind() {
  server.listen(SOCK, () => {
    fs.chmodSync(SOCK, 0o600);
    // readiness signal for the spawner (used by cold-start test variant B)
    if (process.env.PC003_READY_FD) {
      try {
        fs.writeSync(Number(process.env.PC003_READY_FD), "ready\n");
        fs.closeSync(Number(process.env.PC003_READY_FD));
      } catch {}
    }
    console.log(JSON.stringify({ event: "listening", pid: process.pid, sock: SOCK }));
    armIdleTimer();
  });
}

server.on("error", (err) => {
  if (err.code !== "EADDRINUSE") {
    console.error("listen error", err);
    process.exit(4);
  }
  // Bind-as-mutex: check whether the current owner is alive.
  const probe = net.connect(SOCK);
  probe.on("connect", () => {
    // live daemon already owns the socket -> we lost the race, exit quietly
    probe.destroy();
    console.log(JSON.stringify({ event: "lost-race", pid: process.pid }));
    process.exit(0);
  });
  probe.on("error", () => {
    // stale socket file (previous daemon died without cleanup) -> reclaim
    try {
      fs.unlinkSync(SOCK);
    } catch {}
    console.log(JSON.stringify({ event: "reclaimed-stale-socket", pid: process.pid }));
    bind();
  });
});

bind();
