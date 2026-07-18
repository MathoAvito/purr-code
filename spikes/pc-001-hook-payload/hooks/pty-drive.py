#!/usr/bin/env python3
"""PC-001 throwaway PTY driver for interactive Claude Code scenarios.

Usage: pty-drive.py <scenario-name> <total-seconds> <step>...
Each step is either:
  s:<seconds>      sleep
  k:<text>         send literal text
  e                send Enter (\r)
  esc              send Esc (0x1b)
  w:<regex>:<sec>  wait until regex appears in cumulative output (timeout sec)
  sigkill          SIGKILL the child (terminal-kill scenario)

Captures all TUI output to evidence/tui-<scenario>.log and prints a
timestamped action trace to stdout.
"""
import os, pty, re, select, signal, subprocess, sys, time

scenario = sys.argv[1]
total = float(sys.argv[2])
steps = sys.argv[3:]

evdir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "evidence")
os.makedirs(evdir, exist_ok=True)
logpath = os.path.join(evdir, f"tui-{scenario}.log")

master, slave = pty.openpty()
os.environ.setdefault("TERM", "xterm-256color")
testbed = os.environ.get("PC001_TESTBED", "testbed")
proc = subprocess.Popen(
    ["claude"], stdin=slave, stdout=slave, stderr=slave,
    cwd=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", testbed),
    start_new_session=True, close_fds=True,
)
os.close(slave)
start = time.time()
buf = b""
log = open(logpath, "wb")

def pump(duration):
    global buf
    end = time.time() + duration
    while time.time() < end:
        r, _, _ = select.select([master], [], [], 0.1)
        if master in r:
            try:
                data = os.read(master, 65536)
            except OSError:
                return False
            if not data:
                return False
            buf += data
            log.write(data)
            log.flush()
    return True

def trace(msg):
    print(f"[{time.time()-start:7.2f}s] {msg}", flush=True)

alive = True
for step in steps:
    if not alive:
        break
    if step.startswith("s:"):
        trace(f"sleep {step[2:]}")
        alive = pump(float(step[2:]))
    elif step.startswith("k:"):
        trace(f"keys {step[2:]!r}")
        os.write(master, step[2:].encode())
        alive = pump(0.3)
    elif step == "e":
        trace("ENTER")
        os.write(master, b"\r")
        alive = pump(0.3)
    elif step == "esc":
        trace("ESC")
        os.write(master, b"\x1b")
        alive = pump(0.3)
    elif step == "sigkill":
        trace(f"SIGKILL pid {proc.pid}")
        os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        alive = False
    elif step.startswith("w:"):
        _, pat, tmo = step.split(":", 2)
        trace(f"wait for /{pat}/ ({tmo}s)")
        deadline = time.time() + float(tmo)
        found = False
        while time.time() < deadline:
            if not pump(0.2):
                alive = False
                break
            if re.search(pat.encode(), buf):
                found = True
                break
        trace(f"wait result: {'FOUND' if found else 'TIMEOUT'}")

# graceful drain, then terminate if still up
deadline = start + total
while alive and time.time() < deadline and proc.poll() is None:
    alive = pump(0.5)
if proc.poll() is None:
    trace("terminating child")
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
    except ProcessLookupError:
        pass
    time.sleep(2)
    if proc.poll() is None:
        os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
trace(f"child exit code: {proc.poll()}")
log.close()
