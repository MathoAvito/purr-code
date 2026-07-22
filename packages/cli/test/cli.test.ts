import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FakeAudioBackend } from "../src/audio/fake/index.js";
import { NoneAudioBackend } from "../src/audio/none/NoneAudioBackend.js";
import { runCli } from "../src/cli/runCli.js";
import { colorEnabled } from "../src/cli/style.js";
import { ControlPipeClient } from "../src/control/client.js";
import { PROTOCOL_VERSION } from "../src/control/protocol.js";
import { resolveConfigFilePath } from "../src/config/index.js";
import { Daemon } from "../src/daemon/Daemon.js";
import { PlaybackController } from "../src/session/PlaybackController.js";
import { daemonIsolationOptions } from "./helpers/controlEndpoint.js";

describe("CLI (PC-306)", () => {
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

  async function harness(): Promise<{
    home: string;
    runtimeDir: string;
    daemon: Daemon;
    audio: FakeAudioBackend;
    logPath: string;
    env: NodeJS.ProcessEnv;
    ensureDaemon: () => Promise<{
      status: "already-running";
      path: string;
      client: ControlPipeClient;
    }>;
    configDir: { home: string; platform: NodeJS.Platform; env: NodeJS.ProcessEnv };
    lines: string[];
    errLines: string[];
  }> {
    const home = await mkdtemp(join(tmpdir(), "purrcode-cli-home-"));
    const runtimeDir = await mkdtemp(join(tmpdir(), "purrcode-cli-rt-"));
    cleanups.push(async () => rm(home, { recursive: true, force: true }));
    cleanups.push(async () => rm(runtimeDir, { recursive: true, force: true }));

    const logPath = join(runtimeDir, "fake.jsonl");
    const audio = new FakeAudioBackend({ logPath, enabled: true });
    const caps = await audio.detect();
    const playback = new PlaybackController({
      backend: audio,
      fadeOutMs: 40,
      fadeInMs: 0,
      volume: 20,
    });
    const iso = daemonIsolationOptions(runtimeDir);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PURRCODE_FAKE_AUDIO: "1",
      PURRCODE_RUNTIME_DIR: runtimeDir,
      NO_COLOR: "1",
      ...(iso.env ?? {}),
    };
    const configDir = {
      home,
      platform: "linux" as const,
      env: { PURRCODE_FAKE_AUDIO: "1" } as NodeJS.ProcessEnv,
    };
    const daemon = new Daemon({
      ...iso,
      idleMs: 60_000,
      audioBackend: audio,
      backendCapabilities: caps,
      backendProbes: [{ tier: "fake", name: "fake", present: true }],
      playback,
      watchdogIntervalMs: 0,
      configDir,
      env,
    });
    await daemon.start();
    cleanups.push(async () => daemon.shutdown());

    const ensureDaemon = async () => {
      const client = new ControlPipeClient({ path: daemon.controlPath });
      await client.ensureConnected(2000);
      return { status: "already-running" as const, path: daemon.controlPath, client };
    };

    const lines: string[] = [];
    const errLines: string[] = [];
    return {
      home,
      runtimeDir,
      daemon,
      audio,
      logPath,
      env,
      ensureDaemon,
      configDir,
      lines,
      errLines,
    };
  }

  it("respects NO_COLOR", () => {
    expect(colorEnabled({ NO_COLOR: "1" })).toBe(false);
    expect(colorEnabled({ FORCE_COLOR: "0" })).toBe(false);
  });

  it("help exits 0", async () => {
    const lines: string[] = [];
    const res = await runCli({
      argv: ["help"],
      env: { NO_COLOR: "1" },
      stdout: (l) => lines.push(l),
      stderr: () => undefined,
      ensureDaemon: () => {
        throw new Error("should not spawn");
      },
    });
    expect(res.exitCode).toBe(0);
    expect(lines.join("\n")).toContain("purrcode on|off");
  });

  it("on/off persists config and updates the daemon", async () => {
    const h = await harness();
    const common = {
      env: h.env,
      ensureDaemon: h.ensureDaemon,
      configDir: h.configDir,
      stdout: (l: string) => h.lines.push(l),
      stderr: (l: string) => h.errLines.push(l),
    };

    let res = await runCli({ ...common, argv: ["off"] });
    expect(res.exitCode).toBe(0);
    expect(h.daemon.getConfig().enabled).toBe(false);
    const diskOff = JSON.parse(await readFile(resolveConfigFilePath(h.configDir), "utf8")) as {
      enabled: boolean;
    };
    expect(diskOff.enabled).toBe(false);

    // Start while muted → idle
    const client = new ControlPipeClient({ path: h.daemon.controlPath });
    cleanups.push(() => {
      client.close();
      return Promise.resolve();
    });
    await client.send({ v: PROTOCOL_VERSION, op: "start", sessionId: "s1" });
    await new Promise((r) => setTimeout(r, 40));
    expect(h.daemon.getSessionRegistry().size).toBe(1);
    let status = await client.request({ v: PROTOCOL_VERSION, op: "status", id: "st" });
    expect(status.result).toMatchObject({ phase: "idle", enabled: false });

    res = await runCli({ ...common, argv: ["on"] });
    expect(res.exitCode).toBe(0);
    expect(h.daemon.getConfig().enabled).toBe(true);

    // Mute alias fades out
    await client.send({ v: PROTOCOL_VERSION, op: "start", sessionId: "s2" });
    await new Promise((r) => setTimeout(r, 40));
    status = await client.request({ v: PROTOCOL_VERSION, op: "status", id: "st2" });
    expect(status.result).toMatchObject({ phase: "playing", enabled: true });

    res = await runCli({ ...common, argv: ["mute"] });
    expect(res.exitCode).toBe(0);
    await new Promise((r) => setTimeout(r, 60));
    status = await client.request({ v: PROTOCOL_VERSION, op: "status", id: "st3" });
    expect(status.result).toMatchObject({ enabled: false });
    expect((status.result as { phase: string }).phase).not.toBe("playing");
  });

  it("volume validates, persists, and applies to a playing loop", async () => {
    const h = await harness();
    const common = {
      env: h.env,
      ensureDaemon: h.ensureDaemon,
      configDir: h.configDir,
      stdout: (l: string) => h.lines.push(l),
      stderr: (l: string) => h.errLines.push(l),
    };

    const bad = await runCli({ ...common, argv: ["volume", "loud"] });
    expect(bad.exitCode).toBe(1);
    expect(h.errLines.join("\n")).toMatch(/0–100/);

    const client = new ControlPipeClient({ path: h.daemon.controlPath });
    cleanups.push(() => {
      client.close();
      return Promise.resolve();
    });
    await client.send({ v: PROTOCOL_VERSION, op: "start", sessionId: "v1" });
    await new Promise((r) => setTimeout(r, 40));

    const res = await runCli({ ...common, argv: ["volume", "33"] });
    expect(res.exitCode).toBe(0);
    expect(h.daemon.getConfig().volume).toBe(33);
    await new Promise((r) => setTimeout(r, 40));
    const log = await readFile(h.logPath, "utf8");
    expect(log).toContain('"type":"volume-change"');
    expect(log).toContain('"volume":33');
  });

  it("status reports daemon health, sessions, backend, sound, volume", async () => {
    const h = await harness();
    const lines: string[] = [];
    const client = new ControlPipeClient({ path: h.daemon.controlPath });
    cleanups.push(() => {
      client.close();
      return Promise.resolve();
    });
    await client.send({ v: PROTOCOL_VERSION, op: "start", sessionId: "st" });
    await new Promise((r) => setTimeout(r, 40));

    const res = await runCli({
      argv: ["status"],
      env: h.env,
      ensureDaemon: h.ensureDaemon,
      configDir: h.configDir,
      stdout: (l) => lines.push(l),
      stderr: () => undefined,
    });
    expect(res.exitCode).toBe(0);
    const text = lines.join("\n");
    expect(text).toContain("running");
    expect(text).toContain("enabled:");
    expect(text).toContain("sound:");
    expect(text).toContain("volume:");
    expect(text).toContain("backend:");
    expect(text).toMatch(/tier fake/);
    expect(text).toMatch(/1 active/);
  });

  it("preview bypasses fake env via injected real-path backend (manual QA covers hardware)", async () => {
    const h = await harness();
    const previewLog = join(h.runtimeDir, "preview-fake.jsonl");
    const previewBackend = new FakeAudioBackend({ logPath: previewLog, enabled: true });
    const caps = await previewBackend.detect();

    const res = await runCli({
      argv: ["preview", "sleepy"],
      env: h.env,
      ensureDaemon: h.ensureDaemon,
      configDir: h.configDir,
      previewMs: 30,
      selectBackend: () =>
        Promise.resolve({
          backend: previewBackend,
          capabilities: { ...caps, tier: "sidecar" as const, name: "test-preview" },
          probes: [],
        }),
      stdout: (l) => h.lines.push(l),
      stderr: (l) => h.errLines.push(l),
    });
    expect(res.exitCode).toBe(0);
    expect(h.lines.join("\n")).toMatch(/Previewing "sleepy"/);
    const log = await readFile(previewLog, "utf8");
    expect(log).toContain('"type":"start"');
    expect(log).toContain('"type":"stop"');
  });

  it("preview fails clearly when no backend is available", async () => {
    const h = await harness();
    const none = new NoneAudioBackend();
    const caps = await none.detect();
    const res = await runCli({
      argv: ["preview"],
      env: h.env,
      ensureDaemon: h.ensureDaemon,
      configDir: h.configDir,
      selectBackend: () =>
        Promise.resolve({
          backend: none,
          capabilities: caps,
          probes: [],
        }),
      stdout: (l) => h.lines.push(l),
      stderr: (l) => h.errLines.push(l),
    });
    expect(res.exitCode).toBe(1);
    expect(h.errLines.join("\n")).toMatch(/No audio backend/);
  });

  it("daemon preview op plays briefly without a Claude session", async () => {
    const h = await harness();
    const client = new ControlPipeClient({ path: h.daemon.controlPath });
    cleanups.push(() => {
      client.close();
      return Promise.resolve();
    });
    const res = await client.request({
      v: PROTOCOL_VERSION,
      op: "preview",
      id: "p1",
      sound: "sleepy",
    });
    expect(res.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 40));
    const log = await readFile(h.logPath, "utf8");
    expect(log).toContain('"type":"start"');
    expect(log).toContain("fake://sleepy");
  });
});
