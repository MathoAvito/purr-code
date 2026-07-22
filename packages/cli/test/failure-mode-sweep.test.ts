/**
 * PC-308 — automated coverage of §20 operational risks reachable via doctor.
 * Human-only remnants are listed in docs/planning/reviews/pc-308-failure-mode-sweep.md.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FakeAudioBackend } from "../src/audio/fake/index.js";
import { NoneAudioBackend } from "../src/audio/none/NoneAudioBackend.js";
import { collectDoctorChecks } from "../src/cli/doctorChecks.js";
import { ControlPipeClient } from "../src/control/client.js";
import { PROTOCOL_VERSION } from "../src/control/protocol.js";
import { Daemon } from "../src/daemon/Daemon.js";
import { PlaybackController } from "../src/session/PlaybackController.js";
import { daemonIsolationOptions } from "./helpers/controlEndpoint.js";

describe("failure-mode sweep via doctor (PC-308 / §20)", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length) {
      try {
        await cleanups.pop()?.();
      } catch {
        /* ignore */
      }
    }
  });

  async function home(): Promise<string> {
    const h = await mkdtemp(join(tmpdir(), "purrcode-sweep-"));
    cleanups.push(async () => rm(h, { recursive: true, force: true }));
    return h;
  }

  it("missing backend → doctor backend fail", async () => {
    const h = await home();
    const none = new NoneAudioBackend();
    const report = await collectDoctorChecks({
      env: {},
      platform: "linux",
      home: h,
      settingsScopes: [],
      probeClaude: () => Promise.resolve({ present: true, version: "v" }),
      selectBackend: async () => ({
        backend: none,
        capabilities: await none.detect(),
        probes: [],
      }),
      checkRuntimeOwnership: () => Promise.resolve({ ok: true, detail: "ok" }),
      ensureDaemon: () => Promise.reject(new Error("skip")),
    });
    expect(report.checks.find((c) => c.id === "backend")?.status).toBe("fail");
  });

  it("unowned runtime dir → doctor runtime-dir fail", async () => {
    const h = await home();
    const report = await collectDoctorChecks({
      env: {},
      platform: "linux",
      home: h,
      settingsScopes: [],
      probeClaude: () => Promise.resolve({ present: true, version: "v" }),
      selectBackend: async () => {
        const b = new FakeAudioBackend({ logPath: join(h, "f.jsonl"), enabled: true });
        return { backend: b, capabilities: await b.detect(), probes: [] };
      },
      checkRuntimeOwnership: () => Promise.resolve({ ok: false, detail: "owned by another user" }),
      ensureDaemon: () => Promise.reject(new Error("skip")),
    });
    expect(report.checks.find((c) => c.id === "runtime-dir")?.status).toBe("fail");
  });

  it("hook path missing → doctor hook-resolution fail", async () => {
    const h = await home();
    const settings = join(h, "settings.json");
    await writeFile(
      settings,
      JSON.stringify({
        hooks: {
          UserPromptSubmit: [
            {
              hooks: [
                {
                  type: "command",
                  command: "node",
                  args: ["/nonexistent/purrcode-hook.js", "UserPromptSubmit"],
                },
              ],
            },
          ],
        },
      }),
      "utf8",
    );
    const report = await collectDoctorChecks({
      env: {},
      platform: "linux",
      home: h,
      settingsScopes: [{ label: "user", path: settings }],
      probeClaude: () => Promise.resolve({ present: true, version: "v" }),
      selectBackend: async () => {
        const b = new FakeAudioBackend({ logPath: join(h, "f.jsonl"), enabled: true });
        return { backend: b, capabilities: await b.detect(), probes: [] };
      },
      checkRuntimeOwnership: () => Promise.resolve({ ok: true, detail: "ok" }),
      ensureDaemon: () => Promise.reject(new Error("skip")),
    });
    expect(report.checks.find((c) => c.id === "hook-resolution")?.status).toBe("fail");
  });

  it("suspended owner → doctor daemon warn (paused sessions)", async () => {
    const h = await home();
    const runtimeDir = await mkdtemp(join(tmpdir(), "purrcode-sweep-rt-"));
    cleanups.push(async () => rm(runtimeDir, { recursive: true, force: true }));
    const audio = new FakeAudioBackend({
      logPath: join(runtimeDir, "fake.jsonl"),
      enabled: true,
    });
    const iso = daemonIsolationOptions(runtimeDir);
    const daemon = new Daemon({
      ...iso,
      idleMs: 60_000,
      audioBackend: audio,
      backendCapabilities: await audio.detect(),
      playback: new PlaybackController({ backend: audio, fadeOutMs: 40, fadeInMs: 0 }),
      watchdogIntervalMs: 0,
      // Keep the session paused across status reconciliation (simulates Ctrl+Z).
      watchdogClassify: () => "suspended",
    });
    await daemon.start();
    cleanups.push(async () => daemon.shutdown());

    const client = new ControlPipeClient({ path: daemon.controlPath });
    cleanups.push(() => {
      client.close();
      return Promise.resolve();
    });
    await client.send({
      v: PROTOCOL_VERSION,
      op: "start",
      sessionId: "s1",
      claudePid: 424242,
    });
    await new Promise((r) => setTimeout(r, 40));
    expect(daemon.getSessionRegistry().get("s1")?.paused).toBe(true);

    const report = await collectDoctorChecks({
      env: { PURRCODE_RUNTIME_DIR: runtimeDir, PURRCODE_FAKE_AUDIO: "1" },
      platform: "linux",
      home: h,
      settingsScopes: [],
      probeClaude: () => Promise.resolve({ present: true, version: "v" }),
      selectBackend: async () => ({
        backend: audio,
        capabilities: await audio.detect(),
        probes: [],
      }),
      checkRuntimeOwnership: () => Promise.resolve({ ok: true, detail: "ok" }),
      ensureDaemon: async () => {
        const c = new ControlPipeClient({ path: daemon.controlPath });
        await c.ensureConnected(2000);
        return { status: "already-running", path: daemon.controlPath, client: c };
      },
    });
    const daemonCheck = report.checks.find((c) => c.id === "daemon");
    expect(daemonCheck?.status).toBe("warn");
    expect(daemonCheck?.summary).toMatch(/paused/);
  });

  it("disableAllHooks → doctor fail (silent purr)", async () => {
    const h = await home();
    await mkdir(join(h, ".claude"), { recursive: true });
    const settings = join(h, ".claude", "settings.json");
    await writeFile(settings, JSON.stringify({ disableAllHooks: true }), "utf8");
    const report = await collectDoctorChecks({
      env: {},
      platform: "linux",
      home: h,
      settingsScopes: [{ label: "user", path: settings }],
      probeClaude: () => Promise.resolve({ present: true, version: "v" }),
      selectBackend: async () => {
        const b = new FakeAudioBackend({ logPath: join(h, "f.jsonl"), enabled: true });
        return { backend: b, capabilities: await b.detect(), probes: [] };
      },
      checkRuntimeOwnership: () => Promise.resolve({ ok: true, detail: "ok" }),
      ensureDaemon: () => Promise.reject(new Error("skip")),
    });
    expect(report.checks.find((c) => c.id === "disableAllHooks")?.status).toBe("fail");
  });
});
