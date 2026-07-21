import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";

import { afterEach, describe, expect, it } from "vitest";

import {
  classifyProcess,
  parseLinuxStat,
  primaryStateLetter,
  readProcessSnapshot,
  readStarttimeToken,
} from "../src/process/liveness.js";

const isWin = process.platform === "win32";
const isLinux = process.platform === "linux";
const isUnix = !isWin;

/** Spawn a long-lived child; kill + wait on cleanup. */
function spawnSleep(): ChildProcess {
  return spawn(isWin ? "timeout" : "sleep", isWin ? ["/T", "60"] : ["60"], {
    stdio: "ignore",
    windowsHide: true,
  });
}

async function waitExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await once(child, "exit");
}

describe("parseLinuxStat (PC-201)", () => {
  it("parses state and starttime with a simple comm", () => {
    // Minimal 22-field tail after comm — starttime is field 22 (index 19 after state).
    const fields = ["S", ...Array.from({ length: 18 }, (_, i) => String(i)), "999888"];
    const raw = `42 (bash) ${fields.join(" ")}`;
    expect(parseLinuxStat(raw)).toEqual({ state: "S", starttime: "999888" });
  });

  it("handles comm names containing spaces and parentheses", () => {
    const fields = ["R", ...Array.from({ length: 18 }, () => "0"), "12345"];
    const raw = `7 (chrome (gpu) --type=renderer) ${fields.join(" ")}`;
    expect(parseLinuxStat(raw)).toEqual({ state: "R", starttime: "12345" });
  });

  it("returns null when starttime is missing", () => {
    expect(parseLinuxStat("1 (x) S 0 0")).toBeNull();
  });
});

describe("primaryStateLetter (PC-201)", () => {
  it("takes the first letter so macOS flag suffixes are ignored", () => {
    expect(primaryStateLetter("T")).toBe("T");
    expect(primaryStateLetter("SNs")).toBe("S");
    expect(primaryStateLetter("TN")).toBe("T");
    expect(primaryStateLetter("Z")).toBe("Z");
  });
});

describe("classifyProcess with injected snapshots (PC-201)", () => {
  it("classifies running / suspended / dead from state letters", () => {
    const identity = { pid: 1, starttime: "100" };
    const mk = (snap: { state: string; starttime: string } | null) => () => snap;

    expect(
      classifyProcess(identity, {
        platform: "linux",
        readSnapshot: mk({ state: "S", starttime: "100" }),
      }),
    ).toBe("running");
    expect(
      classifyProcess(identity, {
        platform: "linux",
        readSnapshot: mk({ state: "T", starttime: "100" }),
      }),
    ).toBe("suspended");
    expect(
      classifyProcess(identity, {
        platform: "darwin",
        readSnapshot: mk({ state: "TNs", starttime: "100" }),
      }),
    ).toBe("suspended");
    expect(
      classifyProcess(identity, {
        platform: "linux",
        readSnapshot: mk({ state: "Z", starttime: "100" }),
      }),
    ).toBe("dead");
    expect(
      classifyProcess(identity, {
        platform: "linux",
        readSnapshot: mk({ state: "X", starttime: "100" }),
      }),
    ).toBe("dead");
    expect(
      classifyProcess(identity, {
        platform: "linux",
        readSnapshot: mk(null),
      }),
    ).toBe("dead");
  });

  it("treats starttime mismatch as dead (PID-reuse guard)", () => {
    expect(
      classifyProcess(
        { pid: 9, starttime: "aaa" },
        {
          platform: "linux",
          readSnapshot: () => ({ state: "S", starttime: "bbb" }),
        },
      ),
    ).toBe("dead");
  });
});

describe("classifyProcess with real child processes (PC-201)", () => {
  const children: ChildProcess[] = [];

  afterEach(async () => {
    for (const child of children.splice(0)) {
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        try {
          if (isUnix) {
            try {
              process.kill(child.pid, "SIGCONT");
            } catch {
              /* already gone / not stopped */
            }
          }
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }
      await waitExit(child).catch(() => undefined);
    }
  });

  it("classifies a live child as running with a stable starttime token", () => {
    const child = spawnSleep();
    children.push(child);
    expect(child.pid).toBeTypeOf("number");
    const pid = child.pid!;

    const starttime = readStarttimeToken(pid);
    if (isWin) {
      // Existence-only: no starttime token.
      expect(starttime).toBeUndefined();
      expect(classifyProcess({ pid, starttime: "" })).toBe("running");
      return;
    }

    expect(starttime).toBeTypeOf("string");
    expect(starttime!.length).toBeGreaterThan(0);
    const again = readStarttimeToken(pid);
    expect(again).toBe(starttime);

    const snap = readProcessSnapshot(pid);
    expect(snap).not.toBeNull();
    expect(snap!.starttime).toBe(starttime);
    expect(classifyProcess({ pid, starttime: starttime! })).toBe("running");
  });

  it.runIf(isUnix)("detects SIGSTOP as suspended and SIGCONT as running", () => {
    const child = spawnSleep();
    children.push(child);
    const pid = child.pid!;
    const starttime = readStarttimeToken(pid)!;
    expect(starttime).toBeTruthy();

    expect(classifyProcess({ pid, starttime })).toBe("running");

    process.kill(pid, "SIGSTOP");
    expect(classifyProcess({ pid, starttime })).toBe("suspended");

    process.kill(pid, "SIGCONT");
    expect(classifyProcess({ pid, starttime })).toBe("running");
  });

  it("classifies a killed child as dead", async () => {
    const child = spawnSleep();
    children.push(child);
    const pid = child.pid!;
    const starttime = readStarttimeToken(pid) ?? "";

    child.kill("SIGKILL");
    await waitExit(child);

    // Give the kernel a beat to drop the proc entry / reap.
    await new Promise((r) => setTimeout(r, 50));

    expect(classifyProcess({ pid, starttime })).toBe("dead");
    expect(readProcessSnapshot(pid)).toBeNull();
  });

  it.runIf(isLinux)("treats zombie state Z as dead (ADR 0006)", async () => {
    // Fork a child, SIGKILL it, and deliberately leave it unreaped so /proc
    // still shows state Z with the original starttime.
    const holder = spawn(
      "python3",
      [
        "-c",
        `
import os, signal, time, sys
pid = os.fork()
if pid == 0:
    time.sleep(3600)
else:
    os.kill(pid, signal.SIGKILL)
    time.sleep(0.05)
    print(pid, flush=True)
    time.sleep(3600)
`,
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    children.push(holder);

    const stdout = holder.stdout;
    expect(stdout).toBeTruthy();
    const [chunk] = (await once(stdout, "data")) as [Buffer];
    const zombiePid = Number(chunk.toString("utf8").trim());
    expect(zombiePid).toBeGreaterThan(0);

    const snap = readProcessSnapshot(zombiePid);
    expect(snap).not.toBeNull();
    expect(primaryStateLetter(snap!.state)).toBe("Z");

    expect(classifyProcess({ pid: zombiePid, starttime: snap!.starttime })).toBe("dead");
  });

  it.runIf(isWin)("Windows existence-only: live then dead, never suspended", async () => {
    const child = spawnSleep();
    children.push(child);
    const pid = child.pid!;

    expect(classifyProcess({ pid, starttime: "ignored" }, { platform: "win32" })).toBe("running");

    child.kill();
    await waitExit(child);
    await new Promise((r) => setTimeout(r, 50));

    expect(classifyProcess({ pid, starttime: "ignored" }, { platform: "win32" })).toBe("dead");
  });
});
