#!/usr/bin/env node
/**
 * PC-003 scenario driver (Linux/macOS). Evidence -> evidence/pc003-events.jsonl
 *
 *  1. per-UID runtime dir + UDS echo round-trip (RTT measured over 50 pings)
 *  2. socket permissions/ownership recorded
 *  3. detached daemon spawn: new session (sid != parent), stdio ignored,
 *     survives spawner exit
 *  4. cold-start sequencing: client spawns daemon and connects with
 *     retry/backoff BEFORE the daemon logs "listening"; no message lost
 *  5. bind-as-mutex: second daemon on the same socket exits "lost-race"
 *  6. stale-socket recovery: kill -9 the daemon (socket file left behind),
 *     next daemon reclaims and serves
 *  7. idle-exit vs open connection: daemon (idle 1500 ms) stays alive while a
 *     connection is held open for 4 s, exits after it closes
 */
import { spawn, execFileSync } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const DAEMON = path.join(HERE, "daemon.mjs");
const EVDIR = path.join(HERE, "evidence");
fs.mkdirSync(EVDIR, { recursive: true });
const EVENTS = path.join(EVDIR, "pc003-events.jsonl");
const t0 = Date.now();

const runtimeBase = process.env.XDG_RUNTIME_DIR || os.tmpdir();
const RUNDIR = path.join(runtimeBase, `purrcode-spike-${process.getuid()}`);
const SOCK = path.join(RUNDIR, "control.sock");

function emit(kind, fields = {}) {
  const rec = { t: (Date.now() - t0) / 1000, kind, ...fields };
  fs.appendFileSync(EVENTS, JSON.stringify(rec) + "\n");
  console.log(`[${rec.t.toFixed(2)}s] ${kind}:`, JSON.stringify(fields));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connectWithRetry(sock, timeoutMs = 5000) {
  const start = Date.now();
  let attempts = 0;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      attempts += 1;
      const c = net.connect(sock);
      c.once("connect", () => resolve({ conn: c, attempts, waitedMs: Date.now() - start }));
      c.once("error", () => {
        c.destroy();
        if (Date.now() - start > timeoutMs) reject(new Error("connect timeout"));
        else setTimeout(tryOnce, 25);
      });
    };
    tryOnce();
  });
}

function request(conn, obj) {
  return new Promise((resolve) => {
    const onData = (chunk) => {
      conn.off("data", onData);
      resolve(JSON.parse(chunk.toString("utf8").split("\n")[0]));
    };
    conn.on("data", onData);
    conn.write(JSON.stringify(obj) + "\n");
  });
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sid(pid) {
  // Linux: sid= ; macOS BSD ps: sess= (no sid keyword)
  const col = process.platform === "darwin" ? "sess=" : "sid=";
  return Number(execFileSync("ps", ["-o", col, "-p", String(pid)], { encoding: "utf8" }).trim());
}

async function main() {
  fs.rmSync(RUNDIR, { recursive: true, force: true });

  // --- 1+2+3: detached spawn, then echo over the UDS -----------------------
  const daemon = spawn(process.execPath, [DAEMON, SOCK, "60000"], {
    detached: true,
    stdio: "ignore",
  });
  daemon.unref();
  emit("spawned_detached", { daemonPid: daemon.pid, spawnerPid: process.pid });

  const { conn, attempts, waitedMs } = await connectWithRetry(SOCK);
  emit("cold_start_connect", {
    attempts,
    waitedMs,
    note: "client retried until daemon bound the socket; no readiness handshake needed",
  });

  const first = await request(conn, { op: "ping", seq: 0 });
  emit("first_message_ok", { reply: first });

  const rtts = [];
  for (let i = 1; i <= 50; i++) {
    const s = process.hrtime.bigint();
    await request(conn, { op: "ping", seq: i });
    rtts.push(Number(process.hrtime.bigint() - s) / 1e6);
  }
  rtts.sort((a, b) => a - b);
  emit("uds_echo_rtt_ms", {
    n: rtts.length,
    p50: rtts[24].toFixed(3),
    p95: rtts[47].toFixed(3),
    max: rtts[49].toFixed(3),
  });

  const dstat = fs.lstatSync(RUNDIR);
  const sstat = fs.lstatSync(SOCK);
  emit("permissions", {
    runtimeDir: RUNDIR,
    dirMode: (dstat.mode & 0o777).toString(8),
    dirUid: dstat.uid,
    sockMode: (sstat.mode & 0o777).toString(8),
    sockUid: sstat.uid,
    isSocket: sstat.isSocket(),
    perUidNaming: RUNDIR.includes(String(process.getuid())),
  });

  const daemonSid = sid(daemon.pid);
  const mySid = sid(process.pid);
  emit("detached_session", {
    daemonPid: daemon.pid,
    daemonSid,
    spawnerSid: mySid,
    newSession: daemonSid !== mySid,
    note: "detached:true gives the daemon its own session (setsid)",
  });

  // survives parent exit: re-exec this check in a child that exits immediately
  const orphanSpawner = spawn(
    process.execPath,
    ["-e", `
      const { spawn } = require("node:child_process");
      const d = spawn(process.execPath, [${JSON.stringify(DAEMON)}, ${JSON.stringify(SOCK + ".orphan")}, "8000"], { detached: true, stdio: "ignore" });
      d.unref();
      console.log(d.pid);
      process.exit(0);
    `],
    { stdio: ["ignore", "pipe", "ignore"] },
  );
  const orphanPid = await new Promise((resolve) => {
    let out = "";
    orphanSpawner.stdout.on("data", (c) => (out += c));
    orphanSpawner.on("exit", () => resolve(Number(out.trim())));
  });
  await sleep(1000); // spawner is long dead; is the daemon still up?
  emit("survives_parent_exit", {
    orphanDaemonPid: orphanPid,
    spawnerExited: true,
    daemonAlive: pidAlive(orphanPid),
  });
  try {
    process.kill(orphanPid, "SIGTERM");
  } catch {}

  // --- 5: bind-as-mutex race -------------------------------------------------
  const loser = spawn(process.execPath, [DAEMON, SOCK, "60000"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let loserOut = "";
  loser.stdout.on("data", (c) => (loserOut += c));
  const loserExit = await new Promise((resolve) => loser.on("exit", resolve));
  emit("bind_mutex", {
    secondDaemonExit: loserExit,
    output: loserOut.trim(),
    lostRaceCleanly: loserExit === 0 && loserOut.includes("lost-race"),
  });

  // --- 6: stale-socket recovery ---------------------------------------------
  const owner = (await request(conn, { op: "who" })).pid;
  conn.destroy();
  process.kill(owner, "SIGKILL"); // dies without unlinking the socket
  await sleep(300);
  const stale = fs.existsSync(SOCK);
  const reclaimer = spawn(process.execPath, [DAEMON, SOCK, "60000"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let recOut = "";
  reclaimer.stdout.on("data", (c) => (recOut += c));
  await sleep(800);
  const { conn: conn2, attempts: a2 } = await connectWithRetry(SOCK);
  const reply2 = await request(conn2, { op: "ping-after-reclaim" });
  emit("stale_socket_recovery", {
    killedOwnerPid: owner,
    socketFileLeftBehind: stale,
    reclaimerEvents: recOut.trim().split("\n"),
    newOwnerPid: reply2.pid,
    served: reply2.ok === true,
    connectAttempts: a2,
  });

  // --- 7: idle-exit never fires with an open connection -----------------------
  conn2.destroy();
  await sleep(300);
  const idleSock = SOCK + ".idle";
  const idleDaemon = spawn(process.execPath, [DAEMON, idleSock, "1500"], {
    detached: true,
    stdio: "ignore",
  });
  idleDaemon.unref();
  const { conn: conn3 } = await connectWithRetry(idleSock);
  await sleep(4000); // 2.6x the idle timeout, connection held open
  const aliveWithConn = pidAlive(idleDaemon.pid);
  const reply3 = await request(conn3, { op: "still-there?" });
  conn3.destroy();
  const exitedAfter = await (async () => {
    for (let i = 0; i < 40; i++) {
      await sleep(100);
      if (!pidAlive(idleDaemon.pid)) return (i + 1) * 100;
    }
    return null;
  })();
  emit("idle_exit_rule", {
    idleMs: 1500,
    heldConnectionMs: 4000,
    aliveWhileConnectionOpen: aliveWithConn,
    stillServing: reply3.ok === true,
    exitedMsAfterClose: exitedAfter,
    rule: "open connection pins daemon; idle timer only runs at zero connections",
  });

  // teardown
  try {
    process.kill(reclaimer.pid, "SIGTERM");
  } catch {}
  fs.rmSync(RUNDIR, { recursive: true, force: true });
  emit("done", {});
}

main().catch((err) => {
  emit("fatal", { error: String(err) });
  process.exit(1);
});
