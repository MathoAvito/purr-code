/**
 * Cross-platform PID liveness for the PC-006 throwaway daemon (Linux + macOS).
 * Linux: /proc/<pid>/stat → { state, starttime:number }
 * macOS: ps -o state=,lstart= → { state, starttime:string }  (lstart is the identity token)
 */
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");

function statOf(pid) {
  if (pid == null || !Number.isFinite(Number(pid))) {
    return null;
  }
  if (process.platform === "linux") {
    try {
      const raw = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
      const fields = raw.slice(raw.lastIndexOf(")") + 2).split(" ");
      return { state: fields[0], starttime: Number(fields[19]) };
    } catch {
      return null;
    }
  }

  // darwin / other Unix: ps
  try {
    const out = execFileSync(
      "ps",
      ["-o", "state=,lstart=", "-p", String(pid)],
      { encoding: "utf8" },
    ).trim();
    if (!out) {
      return null;
    }
    const m = out.match(/^(\S+)\s+(.+)$/);
    if (!m) {
      return null;
    }
    return { state: m[1], starttime: m[2].trim() };
  } catch {
    return null;
  }
}

function starttimeOf(pid) {
  return statOf(pid)?.starttime ?? null;
}

function isDead(stat, expectedStarttime) {
  if (stat === null) {
    return true;
  }
  if (stat.starttime !== expectedStarttime) {
    return true;
  }
  // Linux zombies; macOS may report Z similarly
  if (stat.state === "Z" || stat.state === "X") {
    return true;
  }
  return false;
}

module.exports = { statOf, starttimeOf, isDead };
