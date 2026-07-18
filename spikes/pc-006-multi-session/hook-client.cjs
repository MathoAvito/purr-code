#!/usr/bin/env node
/**
 * PC-006 hook client. Registered for UserPromptSubmit / Stop / StopFailure /
 * SessionEnd; maps the event to a daemon op and sends one NDJSON line over
 * the UDS. Spawns the daemon on demand with connect-retry (ADR 0003 cold
 * start). Fail-silent: always exits 0, never writes to stdout/stderr.
 *
 * argv[2] = event label; env PC006_SOCK / PC006_PLAYER_LOG point at the run.
 */
const net = require("net");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const LABEL = process.argv[2] || "unknown";
const SOCK = process.env.PC006_SOCK;
const PLAYER_LOG = process.env.PC006_PLAYER_LOG;
const OPS = {
  UserPromptSubmit: "start",
  Stop: "stop",
  StopFailure: "stop",
  SessionEnd: "session-end",
};

function starttimeOf(pid) {
  try {
    const raw = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    return Number(raw.slice(raw.lastIndexOf(")") + 2).split(" ")[19]);
  } catch {
    return null;
  }
}

function dbg(line) {
  if (!process.env.PC006_DEBUG_LOG) return;
  try {
    fs.appendFileSync(process.env.PC006_DEBUG_LOG, `${new Date().toISOString()} ${line}\n`);
  } catch {}
}

async function main() {
  dbg(`invoked label=${LABEL} ppid=${process.ppid}`);
  const op = OPS[LABEL];
  if (!op || !SOCK) return;

  let stdin = "";
  process.stdin.setEncoding("utf8");
  for await (const c of process.stdin) stdin += c;
  let payload = {};
  try {
    payload = JSON.parse(stdin);
  } catch {}

  const claudePid = process.ppid; // hook's parent is the claude process (ADR 0002)
  const msg = JSON.stringify({
    op,
    sessionId: payload.session_id || "unknown",
    pid: claudePid,
    starttime: starttimeOf(claudePid),
  });

  for (let attempt = 0; attempt < 20; attempt++) {
    const ok = await new Promise((resolve) => {
      const conn = net.connect(SOCK, () => {
        conn.end(msg + "\n");
        conn.on("close", () => resolve(true));
      });
      conn.on("error", () => resolve(false));
    });
    if (ok) return;
    if (attempt === 0) {
      // stale socket or no daemon: try unlink+spawn (bind-as-mutex resolves races)
      try {
        fs.unlinkSync(SOCK);
      } catch {}
      const child = spawn(
        process.execPath,
        [path.join(__dirname, "proto-daemon.mjs"), SOCK, PLAYER_LOG],
        { detached: true, stdio: "ignore" },
      );
      child.unref();
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
