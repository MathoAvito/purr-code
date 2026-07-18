#!/usr/bin/env node
/**
 * PC-001 throwaway logging hook.
 *
 * Captures everything about a hook invocation as one JSONL record:
 *   - which event label it was registered under (argv[2])
 *   - the raw + parsed stdin payload Claude Code sends
 *   - pid / ppid and the parent's cmdline (is the parent Claude Code?)
 *   - CLAUDE_* environment variables (values), other env var names only
 *   - timings (spawn -> stdin closed -> exit)
 *
 * Behavior toggles for scenario testing (set as env vars in settings.json):
 *   PC001_SLEEP_MS   sleep this long before exiting (async non-blocking test)
 *   PC001_EXIT_CODE  exit with this code (transcript-notice test)
 *   PC001_STDOUT     print this string to stdout (context-injection test)
 *   PC001_STDERR     print this string to stderr (transcript-notice test)
 *
 * Evidence lands in ../evidence/hook-events.jsonl relative to this script.
 * Throwaway spike code: no lint, never imported by product code.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const EVIDENCE_FILE = path.join(__dirname, '..', 'evidence', 'hook-events.jsonl');
const spawnedAt = Date.now();
const eventLabel = process.argv[2] || 'UNLABELED';

function parentCmdline(ppid) {
  try {
    if (process.platform === 'linux') {
      return fs.readFileSync(`/proc/${ppid}/cmdline`, 'utf8').split('\0').filter(Boolean).join(' ');
    }
    // macOS/Windows fallback handled by whoever runs the spike there.
    const { execFileSync } = require('node:child_process');
    if (process.platform === 'darwin') {
      return execFileSync('ps', ['-o', 'command=', '-p', String(ppid)], { encoding: 'utf8' }).trim();
    }
    if (process.platform === 'win32') {
      return execFileSync(
        'powershell',
        ['-NoProfile', '-Command', `(Get-Process -Id ${ppid}).Path`],
        { encoding: 'utf8' },
      ).trim();
    }
  } catch (err) {
    return `<unavailable: ${err.message}>`;
  }
  return '<unknown platform>';
}

function grandParent(ppid) {
  try {
    if (process.platform === 'linux') {
      const stat = fs.readFileSync(`/proc/${ppid}/stat`, 'utf8');
      // field 4 (1-indexed) after the parenthesized comm is the ppid
      const afterComm = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      const gppid = Number(afterComm[1]);
      return { pid: gppid, cmdline: parentCmdline(gppid) };
    }
  } catch (err) {
    return `<unavailable: ${err.message}>`;
  }
  return '<linux only in this helper>';
}

const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', async () => {
  const stdinClosedAt = Date.now();
  const raw = Buffer.concat(chunks).toString('utf8');
  let parsed = null;
  let parseError = null;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    parseError = err.message;
  }

  const claudeEnv = {};
  const otherEnvNames = [];
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith('CLAUDE')) claudeEnv[k] = v;
    else otherEnvNames.push(k);
  }

  const record = {
    ts: new Date(spawnedAt).toISOString(),
    eventLabel,
    platform: process.platform,
    node: process.version,
    pid: process.pid,
    ppid: process.ppid,
    parentCmdline: parentCmdline(process.ppid),
    grandParent: grandParent(process.ppid),
    claudeEnv,
    otherEnvNames: otherEnvNames.sort(),
    stdinBytes: raw.length,
    stdinRaw: raw,
    stdinParsed: parsed,
    stdinParseError: parseError,
    timings: { spawnToStdinCloseMs: stdinClosedAt - spawnedAt },
    toggles: {
      sleepMs: process.env.PC001_SLEEP_MS || null,
      exitCode: process.env.PC001_EXIT_CODE || null,
      stdout: process.env.PC001_STDOUT || null,
      stderr: process.env.PC001_STDERR || null,
    },
  };

  fs.mkdirSync(path.dirname(EVIDENCE_FILE), { recursive: true });
  fs.appendFileSync(EVIDENCE_FILE, JSON.stringify(record) + '\n');

  // toggles apply only to the event named in PC001_TARGET (or all if unset)
  const targeted = !process.env.PC001_TARGET || eventLabel.startsWith(process.env.PC001_TARGET);

  if (targeted && process.env.PC001_STDOUT) process.stdout.write(process.env.PC001_STDOUT + '\n');
  if (targeted && process.env.PC001_STDERR) process.stderr.write(process.env.PC001_STDERR + '\n');

  const sleepMs = targeted ? Number(process.env.PC001_SLEEP_MS || 0) : 0;
  if (sleepMs > 0) await new Promise((r) => setTimeout(r, sleepMs));

  const exitRecord = { ts: new Date().toISOString(), eventLabel, pid: process.pid, exit: true, aliveMs: Date.now() - spawnedAt };
  fs.appendFileSync(EVIDENCE_FILE, JSON.stringify(exitRecord) + '\n');

  process.exit(targeted ? Number(process.env.PC001_EXIT_CODE || 0) : 0);
});
