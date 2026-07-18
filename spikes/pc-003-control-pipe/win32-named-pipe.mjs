#!/usr/bin/env node
/**
 * PC-003 Windows named-pipe prototype — NOT YET RUN (no Windows machine on
 * this spike; execute during the PC-009 platform rerun).
 *
 * What it must demonstrate on Windows:
 *   - duplex request/response over \\.\pipe\purrcode-<per-user suffix>
 *   - per-user naming: suffix derived from the user SID (whoami /user) so two
 *     users on one machine never collide; fall back to USERNAME if SID lookup
 *     fails
 *   - elevated <-> non-elevated interop: run the daemon from a normal prompt
 *     and the client from an elevated one (and vice versa); record whether
 *     connect fails (expected failure mode: default pipe security descriptor
 *     may deny the other integrity level -> ERROR_ACCESS_DENIED)
 *
 * Node's net module maps named pipes transparently when the path starts with
 * \\.\pipe\, so daemon.mjs works as-is except for:
 *   - no fs.chmodSync on the pipe (ACLs, not modes)
 *   - no unlink for stale sockets (the OS removes a pipe when the last handle
 *     closes -> the stale-socket branch never triggers; EADDRINUSE + live
 *     probe is still the spawn mutex)
 *
 * Usage (Windows):
 *   node win32-named-pipe.mjs daemon   # in terminal 1
 *   node win32-named-pipe.mjs client   # in terminal 2 (try elevated too)
 */
import net from "node:net";
import { execFileSync } from "node:child_process";
import process from "node:process";

function pipeName() {
  let suffix = process.env.USERNAME || "user";
  try {
    const out = execFileSync("whoami", ["/user", "/fo", "csv", "/nh"], { encoding: "utf8" });
    const sid = out.split(",").pop().replace(/"/g, "").trim();
    if (sid.startsWith("S-")) suffix = sid;
  } catch {}
  return `\\\\.\\pipe\\purrcode-${suffix}`;
}

const PIPE = pipeName();
const role = process.argv[2];

if (role === "daemon") {
  const server = net.createServer((conn) => {
    conn.on("data", (chunk) => {
      for (const line of chunk.toString("utf8").split("\n").filter(Boolean)) {
        conn.write(JSON.stringify({ ok: true, echo: JSON.parse(line), pid: process.pid }) + "\n");
      }
    });
    conn.on("error", () => {});
  });
  server.on("error", (err) => {
    console.log(JSON.stringify({ event: "listen-error", code: err.code }));
    process.exit(1);
  });
  server.listen(PIPE, () => console.log(JSON.stringify({ event: "listening", pipe: PIPE })));
} else if (role === "client") {
  const conn = net.connect(PIPE);
  conn.on("connect", () => conn.write(JSON.stringify({ op: "ping", elevated: "record manually" }) + "\n"));
  conn.on("data", (d) => {
    console.log(JSON.stringify({ event: "reply", data: d.toString("utf8").trim() }));
    process.exit(0);
  });
  conn.on("error", (err) => {
    console.log(JSON.stringify({ event: "connect-error", code: err.code, note: "record elevation state of both sides" }));
    process.exit(1);
  });
} else {
  console.error("usage: win32-named-pipe.mjs daemon|client");
  process.exit(2);
}
