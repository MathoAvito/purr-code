#!/usr/bin/env python3
"""PC-002 throwaway probe: Claude PID capture & process-state detection (Linux).

Scenarios, all against a real `claude` TUI spawned in a PTY (reusing the
PC-001 testbed-execform hook settings, whose log-hook records its ppid):

  A. parent-PID identity  — the ppid recorded by the exec-form hook equals the
     PID of the `claude` process we spawned.
  B. suspend detection    — watchdog polls /proc/<pid>/stat every 2 s;
     SIGTSTP -> state 'T' within one cycle; SIGCONT -> running again.
     Also tests a raw Ctrl+Z keypress (0x1a) through the PTY: Claude Code runs
     the terminal in raw mode, so the tty driver never sees it — recorded.
  C. PID identity over time — (pid, starttime) pair from /proc/<pid>/stat
     field 22 is stable for the process lifetime and is the reuse guard.
  D. ancestor-walk fallback — resolve a hook-like child back to `claude` by
     walking ppids, in case a future version reparents hooks.

Evidence: evidence/pc002-events.jsonl (one record per observation).
"""
import json, os, pty, select, signal, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
PC001 = os.path.join(HERE, "..", "pc-001-hook-payload")
TESTBED = os.path.join(PC001, "testbed-execform")
EVDIR = os.path.join(HERE, "evidence")
os.makedirs(EVDIR, exist_ok=True)
EVENTS = os.path.join(EVDIR, "pc002-events.jsonl")
HOOK_LOG = os.path.join(PC001, "evidence", "hook-events.jsonl")

t0 = time.time()


def emit(kind, **fields):
    rec = {"t": round(time.time() - t0, 3), "kind": kind, **fields}
    with open(EVENTS, "a") as f:
        f.write(json.dumps(rec) + "\n")
    print(f"[{rec['t']:7.2f}s] {kind}: {fields}", flush=True)


def proc_stat(pid):
    """state (field 3) and starttime (field 22) from /proc/<pid>/stat."""
    with open(f"/proc/{pid}/stat") as f:
        raw = f.read()
    after_comm = raw[raw.rindex(")") + 2 :].split(" ")
    return {"state": after_comm[0], "starttime": int(after_comm[19])}


def proc_cmdline(pid):
    with open(f"/proc/{pid}/cmdline", "rb") as f:
        return f.read().split(b"\0")[0].decode() or "?"


def proc_ppid(pid):
    with open(f"/proc/{pid}/stat") as f:
        raw = f.read()
    return int(raw[raw.rindex(")") + 2 :].split(" ")[1])


def ancestor_walk(pid, needle="claude", max_depth=15):
    chain = []
    for _ in range(max_depth):
        try:
            name = proc_cmdline(pid)
        except OSError:
            break
        chain.append({"pid": pid, "cmd": name})
        if needle in os.path.basename(name):
            return chain, pid
        if pid == 1:
            break
        pid = proc_ppid(pid)
    return chain, None


OUTBUF = b""


def pump(master, duration):
    global OUTBUF
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
            OUTBUF += data
    return True


def wait_ready(master, timeout=25):
    """Wait for the prompt UI; press Enter through any trust/onboarding dialog."""
    global OUTBUF
    start = time.time()
    while time.time() - start < timeout:
        pump(master, 0.3)
        if b"shortcuts" in OUTBUF:
            return True
        if b"trust" in OUTBUF.lower() or b"Enter to confirm" in OUTBUF:
            OUTBUF = b""
            os.write(master, b"\r")
            pump(master, 1.0)
    return False


def main():
    if os.path.exists(HOOK_LOG):
        os.remove(HOOK_LOG)

    master, slave = pty.openpty()
    env = dict(os.environ, ANTHROPIC_BASE_URL="http://127.0.0.1:41100", ANTHROPIC_API_KEY="pc001-mock",
               PC001_TARGET="UserPromptSubmit", PC001_SLEEP_MS="8000")
    claude = subprocess.Popen(
        ["claude"], stdin=slave, stdout=slave, stderr=slave,
        cwd=TESTBED, env=env, start_new_session=True, close_fds=True,
    )
    os.close(slave)
    emit("spawned", claude_pid=claude.pid, cmd=proc_cmdline(claude.pid))

    baseline = proc_stat(claude.pid)
    emit("scenario_c_identity", pid=claude.pid, **baseline,
         note="(pid, starttime) is the identity token; starttime is clock ticks since boot")

    ready = wait_ready(master)
    emit("tui_ready", ready=ready)

    # submit a prompt so the UserPromptSubmit hook fires; PC001_SLEEP_MS keeps
    # the hook process alive long enough to ancestor-walk from it
    os.write(master, b"Reply pong")
    pump(master, 0.5)
    os.write(master, b"\r")

    # --- Scenario A: hook ppid == spawned claude pid --------------------------
    hook_ppid = hook_pid = None
    deadline = time.time() + 15
    while time.time() < deadline and hook_ppid is None:
        if os.path.exists(HOOK_LOG):
            for line in open(HOOK_LOG):
                r = json.loads(line)
                if not r.get("exit"):
                    hook_ppid, hook_pid = r["ppid"], r["pid"]
                    break
        if hook_ppid is None:
            pump(master, 0.5)
    emit("scenario_a_parent_pid", hook_pid=hook_pid, hook_ppid=hook_ppid,
         claude_pid=claude.pid, match=hook_ppid == claude.pid)

    # --- Scenario D: ancestor walk from the live hook process -----------------
    if hook_pid is not None:
        try:
            chain, found = ancestor_walk(hook_pid)
        except OSError:
            chain, found = [], None
        emit("scenario_d_ancestor_walk_from_hook", hook_pid=hook_pid,
             found_claude_pid=found, match=found == claude.pid, chain=chain)
    # control: a process unrelated to claude never resolves to it
    probe_child = subprocess.Popen(["sleep", "30"])
    _, found_none = ancestor_walk(probe_child.pid)
    probe_child.kill()
    emit("scenario_d_control", unrelated_process_found=found_none)

    # --- Scenario B: watchdog cadence suspend/resume ---------------------------
    cadence = 2.0

    def watch_until(pred, timeout, label):
        cycles = 0
        start = time.time()
        while time.time() - start < timeout:
            cycles += 1
            st = proc_stat(claude.pid)
            emit("watchdog_poll", label=label, cycle=cycles, **st)
            if pred(st["state"]):
                return cycles, time.time() - start
            pump(master, cadence)
        return None, time.time() - start

    # B1: raw Ctrl+Z keypress through the PTY (raw mode -> app consumes it)
    os.write(master, b"\x1a")
    pump(master, 2 * cadence + 0.5)
    st = proc_stat(claude.pid)
    emit("scenario_b1_ctrl_z_keypress", state_after=st["state"],
         suspended=st["state"] == "T",
         note="raw-mode TUI: tty driver does not deliver SIGTSTP for ^Z")

    # B2: SIGTSTP — catchable; does Claude Code actually suspend?
    os.kill(claude.pid, signal.SIGTSTP)
    emit("sent", signal="SIGTSTP", pid=claude.pid)
    cycles, elapsed = watch_until(lambda s: s == "T", 2 * cadence, "sigtstp")
    emit("scenario_b2_sigtstp", suspended=cycles is not None,
         note="TUIs may catch SIGTSTP; a handled SIGTSTP never reaches state T")

    # B3: SIGSTOP — uncatchable; the ground truth for T-state detection
    os.kill(claude.pid, signal.SIGSTOP)
    emit("sent", signal="SIGSTOP", pid=claude.pid)
    cycles, elapsed = watch_until(lambda s: s == "T", 3 * cadence, "detect-suspend")
    emit("scenario_b3_sigstop_detect", cycles=cycles, elapsed=round(elapsed, 3),
         detected=cycles is not None)

    # B4: SIGCONT (fg equivalent) -> detect running again within one cycle
    os.kill(claude.pid, signal.SIGCONT)
    emit("sent", signal="SIGCONT", pid=claude.pid)
    cycles, elapsed = watch_until(lambda s: s != "T", 3 * cadence, "detect-resume")
    emit("scenario_b4_sigcont_detect", cycles=cycles, elapsed=round(elapsed, 3),
         detected=cycles is not None)

    # --- Scenario C follow-up: identity stable across suspend/resume ----------
    final = proc_stat(claude.pid)
    emit("scenario_c_identity_stable", pid=claude.pid, **final,
         starttime_unchanged=final["starttime"] == baseline["starttime"])

    # PID-reuse context for the record
    with open("/proc/sys/kernel/pid_max") as f:
        pid_max = int(f.read().strip())
    emit("pid_reuse_context", pid_max=pid_max,
         note="reuse requires full pid-space wraparound between watchdog cycles")

    # teardown
    try:
        os.killpg(os.getpgid(claude.pid), signal.SIGTERM)
    except ProcessLookupError:
        pass
    time.sleep(1)
    if claude.poll() is None:
        os.killpg(os.getpgid(claude.pid), signal.SIGKILL)
    # after death the identity read must fail -> liveness signal
    time.sleep(0.5)
    try:
        proc_stat(claude.pid)
        emit("scenario_c_postmortem", stat_readable=True)
    except OSError as err:
        emit("scenario_c_postmortem", stat_readable=False, errno=err.errno)
    emit("done", claude_exit=claude.poll())


if __name__ == "__main__":
    sys.exit(main())
