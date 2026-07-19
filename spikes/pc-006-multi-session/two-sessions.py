#!/usr/bin/env python3
"""PC-006 driver: run two concurrent interactive Claude Code sessions in PTYs
against the PC-001 mock API and step them through interleaved turns.

Usage: two-sessions.py <scenario> <sessions> <step>...
Steps:
  s:<sec>          sleep (pumping all sessions)
  <i>.k:<text>     send text to session i (1-based)
  <i>.e            send Enter to session i
  <i>.sigkill      SIGKILL session i's process group (terminal-kill case)
  <i>.q            quit session i gracefully (/exit + Enter)

All TUI output goes to evidence/tui-<scenario>-s<i>.log.
"""
import os, pty, select, signal, subprocess, sys, time

scenario = sys.argv[1]
nsessions = int(sys.argv[2])
steps = sys.argv[3:]

here = os.path.dirname(os.path.abspath(__file__))
evdir = os.path.join(here, "evidence")
os.makedirs(evdir, exist_ok=True)
os.environ.setdefault("TERM", "xterm-256color")

class Session:
    def __init__(self, idx):
        self.idx = idx
        self.master, slave = pty.openpty()
        self.buf = b""
        self.log = open(os.path.join(evdir, f"tui-{scenario}-s{idx}.log"), "wb")
        self.proc = subprocess.Popen(
            ["claude"], stdin=slave, stdout=slave, stderr=slave,
            cwd=os.path.join(here, "testbed"),
            start_new_session=True, close_fds=True,
        )
        os.close(slave)
        self.alive = True

    def read_avail(self):
        if not self.alive:
            return
        r, _, _ = select.select([self.master], [], [], 0)
        if self.master in r:
            try:
                data = os.read(self.master, 65536)
            except OSError:
                self.alive = False
                return
            if not data:
                self.alive = False
                return
            self.buf += data
            self.log.write(data)
            self.log.flush()

    def write(self, data):
        os.write(self.master, data)

start = time.time()
def trace(msg):
    print(f"[{time.time()-start:7.2f}s] {msg}", flush=True)

sessions = [Session(i + 1) for i in range(nsessions)]

def pump(duration):
    end = time.time() + duration
    while time.time() < end:
        for s in sessions:
            s.read_avail()
        time.sleep(0.05)

def wait_ready(s, timeout=30):
    deadline = time.time() + timeout
    while time.time() < deadline:
        pump(0.3)
        if b"shortcuts" in s.buf:
            return True
        low = s.buf.lower()
        if b"trust" in low or b"enter to confirm" in low:
            s.buf = b""
            s.write(b"\r")
            pump(1.0)
    return False

for s in sessions:
    ok = wait_ready(s)
    trace(f"session {s.idx} ready: {ok} (pid {s.proc.pid})")
    # Dismiss Claude Code welcome / tips panel if present (macOS fresh installs).
    s.write(b"\x1b")
    pump(0.5)

for step in steps:
    if step.startswith("s:"):
        trace(f"sleep {step[2:]}")
        pump(float(step[2:]))
        continue
    idx, cmd = step.split(".", 1)
    s = sessions[int(idx) - 1]
    if cmd.startswith("k:"):
        trace(f"s{s.idx} keys {cmd[2:]!r}")
        s.write(cmd[2:].encode())
        pump(0.3)
    elif cmd == "e":
        trace(f"s{s.idx} ENTER")
        s.write(b"\r")
        pump(0.3)
    elif cmd == "sigkill":
        trace(f"s{s.idx} SIGKILL pid {s.proc.pid}")
        os.killpg(os.getpgid(s.proc.pid), signal.SIGKILL)
        s.alive = False
    elif cmd == "q":
        trace(f"s{s.idx} /exit")
        s.write(b"/exit")
        pump(0.5)
        s.write(b"\r")
        pump(1.0)

# teardown any survivors
for s in sessions:
    if s.proc.poll() is None:
        try:
            os.killpg(os.getpgid(s.proc.pid), signal.SIGTERM)
        except ProcessLookupError:
            pass
pump(2.0)
for s in sessions:
    if s.proc.poll() is None:
        os.killpg(os.getpgid(s.proc.pid), signal.SIGKILL)
    trace(f"s{s.idx} exit code: {s.proc.poll()}")
    s.log.close()
