import { mkdir, mkdtemp, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FakeAudioBackend } from "../src/audio/fake/index.js";
import { NoneAudioBackend } from "../src/audio/none/NoneAudioBackend.js";
import { collectDoctorChecks } from "../src/cli/doctorChecks.js";
import { runDoctor } from "../src/cli/doctor.js";
import { ControlPipeClient } from "../src/control/client.js";
import { Daemon } from "../src/daemon/Daemon.js";
import { PlaybackController } from "../src/session/PlaybackController.js";
import { daemonIsolationOptions } from "./helpers/controlEndpoint.js";

describe("purrcode doctor (PC-307)", () => {
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

  async function tempHome(): Promise<string> {
    const home = await mkdtemp(join(tmpdir(), "purrcode-doctor-"));
    cleanups.push(async () => rm(home, { recursive: true, force: true }));
    return home;
  }

  async function healthyDaemon(runtimeDir: string) {
    const logPath = join(runtimeDir, "fake.jsonl");
    const audio = new FakeAudioBackend({ logPath, enabled: true });
    const caps = await audio.detect();
    const iso = daemonIsolationOptions(runtimeDir);
    const daemon = new Daemon({
      ...iso,
      idleMs: 60_000,
      audioBackend: audio,
      backendCapabilities: caps,
      playback: new PlaybackController({ backend: audio, fadeOutMs: 40, fadeInMs: 0 }),
      watchdogIntervalMs: 0,
      env: { ...process.env, PURRCODE_FAKE_AUDIO: "1", PURRCODE_RUNTIME_DIR: runtimeDir },
    });
    await daemon.start();
    cleanups.push(async () => daemon.shutdown());
    return {
      ensureDaemon: async () => {
        const client = new ControlPipeClient({ path: daemon.controlPath });
        await client.ensureConnected(2000);
        return { status: "already-running" as const, path: daemon.controlPath, client };
      },
    };
  }

  function baseDeps(home: string, overrides: Record<string, unknown> = {}) {
    return {
      env: { ...process.env, CI: undefined, CLAUDE_CODE_REMOTE: undefined } as NodeJS.ProcessEnv,
      platform: "linux" as const,
      home,
      settingsScopes: [] as { label: string; path: string }[],
      probeClaude: () => Promise.resolve({ present: true, version: "v2.1.test" }),
      selectBackend: async () => {
        const b = new FakeAudioBackend({
          logPath: join(home, "fake.jsonl"),
          enabled: true,
        });
        return {
          backend: b,
          capabilities: await b.detect(),
          probes: [{ tier: "fake" as const, name: "fake", present: true }],
        };
      },
      checkRuntimeOwnership: () => Promise.resolve({ ok: true, detail: "ok" }),
      ...overrides,
    };
  }

  it("prints FR-10 style report and healthy verdict", async () => {
    const home = await tempHome();
    const runtimeDir = await mkdtemp(join(tmpdir(), "purrcode-doc-rt-"));
    cleanups.push(async () => rm(runtimeDir, { recursive: true, force: true }));
    const { ensureDaemon } = await healthyDaemon(runtimeDir);
    const lines: string[] = [];
    const res = await runDoctor({
      env: { NO_COLOR: "1", PURRCODE_RUNTIME_DIR: runtimeDir, PURRCODE_FAKE_AUDIO: "1" },
      out: (l) => lines.push(l),
      ensure: ensureDaemon,
      deps: baseDeps(home, {
        env: {
          NO_COLOR: "1",
          PURRCODE_RUNTIME_DIR: runtimeDir,
          PURRCODE_FAKE_AUDIO: "1",
        },
        ensureDaemon,
      }),
    });
    expect(res.exitCode).toBe(0);
    expect(lines[0]).toBe("PurrCode Doctor");
    expect(lines.join("\n")).toContain("The cat appears healthy.");
    expect(lines.join("\n")).toMatch(/ok .*Claude Code detected/);
  });

  it("fails when disableAllHooks is set", async () => {
    const home = await tempHome();
    const settings = join(home, "settings.json");
    await writeFile(settings, JSON.stringify({ disableAllHooks: true }), "utf8");
    const report = await collectDoctorChecks(
      baseDeps(home, {
        settingsScopes: [{ label: "user", path: settings }],
        ensureDaemon: () => Promise.reject(new Error("skip")),
      }),
    );
    const hit = report.checks.find((c) => c.id === "disableAllHooks");
    expect(hit?.status).toBe("fail");
    expect(hit?.fix).toMatch(/disableAllHooks/);
    expect(report.exitCode).toBe(1);
  });

  it("warns on CI / CLAUDE_CODE_REMOTE suppression", async () => {
    const home = await tempHome();
    const report = await collectDoctorChecks(
      baseDeps(home, {
        env: { CI: "true", PURRCODE_FAKE_AUDIO: "1" },
        ensureDaemon: () => Promise.reject(new Error("skip")),
      }),
    );
    expect(report.checks.find((c) => c.id === "suppression")?.status).toBe("warn");
  });

  it("fails when no audio backend is available", async () => {
    const home = await tempHome();
    const none = new NoneAudioBackend();
    const report = await collectDoctorChecks(
      baseDeps(home, {
        selectBackend: async () => ({
          backend: none,
          capabilities: await none.detect(),
          probes: [],
        }),
        ensureDaemon: () => Promise.reject(new Error("skip")),
      }),
    );
    expect(report.checks.find((c) => c.id === "backend")?.status).toBe("fail");
    expect(report.healthy).toBe(false);
  });

  it("fails on unowned / insecure runtime dir", async () => {
    const home = await tempHome();
    const report = await collectDoctorChecks(
      baseDeps(home, {
        checkRuntimeOwnership: () => Promise.resolve({ ok: false, detail: "owned by uid 0" }),
        ensureDaemon: () => Promise.reject(new Error("skip")),
      }),
    );
    expect(report.checks.find((c) => c.id === "runtime-dir")?.status).toBe("fail");
  });

  it("fails when Claude Code is missing", async () => {
    const home = await tempHome();
    const report = await collectDoctorChecks(
      baseDeps(home, {
        probeClaude: () => Promise.resolve({ present: false, detail: "not found" }),
        ensureDaemon: () => Promise.reject(new Error("skip")),
      }),
    );
    expect(report.checks.find((c) => c.id === "claude")?.status).toBe("fail");
  });

  it("fails on invalid settings JSON", async () => {
    const home = await tempHome();
    const settings = join(home, "broken.json");
    await writeFile(settings, "{not-json", "utf8");
    const report = await collectDoctorChecks(
      baseDeps(home, {
        settingsScopes: [{ label: "user", path: settings }],
        ensureDaemon: () => Promise.reject(new Error("skip")),
      }),
    );
    expect(report.checks.some((c) => c.id === "settings-user" && c.status === "fail")).toBe(true);
  });

  it("warns on plugin + settings hook duplication", async () => {
    const home = await tempHome();
    await mkdir(join(home, ".claude", "plugins"), { recursive: true });
    await writeFile(
      join(home, ".claude", "plugins", "installed_plugins.json"),
      JSON.stringify({ version: 2, plugins: { "purrcode@marketplace": {} } }),
      "utf8",
    );
    const settings = join(home, "settings.json");
    await writeFile(
      settings,
      JSON.stringify({
        hooks: {
          UserPromptSubmit: [
            {
              hooks: [{ type: "command", command: "node", args: ["/x/purrcode-hook.js", "start"] }],
            },
          ],
        },
      }),
      "utf8",
    );
    const report = await collectDoctorChecks(
      baseDeps(home, {
        settingsScopes: [{ label: "user", path: settings }],
        ensureDaemon: () => Promise.reject(new Error("skip")),
      }),
    );
    expect(report.checks.find((c) => c.id === "hook-duplication")?.status).toBe("warn");
  });

  it("fails when selected sound is missing", async () => {
    const home = await tempHome();
    const cfgDir = join(home, ".config", "purrcode");
    await mkdir(cfgDir, { recursive: true });
    await writeFile(
      join(cfgDir, "config.json"),
      JSON.stringify({ schemaVersion: 1, sound: "no-such-sound-xyz", volume: 20, enabled: true }),
      "utf8",
    );
    const report = await collectDoctorChecks(
      baseDeps(home, {
        configDir: { home, platform: "linux", env: {} },
        ensureDaemon: () => Promise.reject(new Error("skip")),
      }),
    );
    expect(report.checks.find((c) => c.id === "sound")?.status).toBe("fail");
  });

  it("fails when daemon is unreachable", async () => {
    const home = await tempHome();
    const report = await collectDoctorChecks(
      baseDeps(home, {
        ensureDaemon: () => Promise.reject(new Error("ECONNREFUSED")),
      }),
    );
    expect(report.checks.find((c) => c.id === "daemon")?.status).toBe("fail");
  });

  it("detects runtime dir symlink as failure (when ownership helper omitted)", async () => {
    const home = await tempHome();
    const runtime = await mkdtemp(join(tmpdir(), "purrcode-rt-real-"));
    const linkParent = await mkdtemp(join(tmpdir(), "purrcode-rt-link-"));
    cleanups.push(async () => rm(runtime, { recursive: true, force: true }));
    cleanups.push(async () => rm(linkParent, { recursive: true, force: true }));
    const link = join(linkParent, "purrcode");
    await symlink(runtime, link);
    const report = await collectDoctorChecks(
      baseDeps(home, {
        env: { XDG_RUNTIME_DIR: linkParent, PURRCODE_FAKE_AUDIO: "1" },
        checkRuntimeOwnership: undefined,
        ensureDaemon: () => Promise.reject(new Error("skip")),
      }),
    );
    // With XDG_RUNTIME_DIR=linkParent, resolve path is linkParent/purrcode which is a symlink
    expect(report.checks.find((c) => c.id === "runtime-dir")?.status).toBe("fail");
  });
});
