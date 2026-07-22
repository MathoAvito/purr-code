import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ControlPipeClient } from "../src/control/client.js";
import { PROTOCOL_VERSION } from "../src/control/protocol.js";
import { Daemon } from "../src/daemon/Daemon.js";
import { ensureDaemonRunning } from "../src/daemon/spawn.js";
import { pidfilePath, readPidfile } from "../src/daemon/pidfile.js";
import { daemonIsolationOptions, expectPlatformControlPath } from "./helpers/controlEndpoint.js";

describe("Daemon (PC-104)", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length) {
      await cleanups.pop()?.();
    }
  });

  async function tempRuntime(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "purrcode-daemon-"));
    cleanups.push(async () => rm(dir, { recursive: true, force: true }));
    return dir;
  }

  async function startIsolatedDaemon(
    overrides: ConstructorParameters<typeof Daemon>[0] = {},
  ): Promise<Daemon> {
    const runtimeDir = overrides?.runtimeDir ?? (await tempRuntime());
    const iso = daemonIsolationOptions(runtimeDir);
    const daemon = new Daemon({
      idleMs: 60_000,
      ...iso,
      ...overrides,
      runtimeDir: iso.runtimeDir,
      ...(iso.windowsPipeSuffix !== undefined
        ? { windowsPipeSuffix: overrides?.windowsPipeSuffix ?? iso.windowsPipeSuffix }
        : {}),
      ...(iso.env !== undefined ? { env: { ...iso.env, ...overrides?.env } } : {}),
    });
    return daemon;
  }

  it("writes a pidfile and answers status", async () => {
    const daemon = await startIsolatedDaemon();
    const listen = await daemon.start();
    expect(listen.status).toBe("listening");
    cleanups.push(async () => daemon.shutdown());

    expect(readPidfile(daemon.getRuntimeDir())).toBe(process.pid);
    const raw = await readFile(pidfilePath(daemon.getRuntimeDir()), "utf8");
    expect(raw.trim()).toBe(String(process.pid));

    const client = new ControlPipeClient({ path: daemon.controlPath });
    cleanups.push(() => {
      client.close();
      return Promise.resolve();
    });
    const status = await client.request({ v: PROTOCOL_VERSION, op: "status", id: "s1" });
    expect(status.ok).toBe(true);
    expect(status.result).toMatchObject({ pid: process.pid, sessions: 0 });
  });

  it("status exposes selected backend capabilities (PC-302)", async () => {
    const { FakeAudioBackend } = await import("../src/audio/fake/index.js");
    const runtimeDir = await tempRuntime();
    const iso = daemonIsolationOptions(runtimeDir);
    const audio = new FakeAudioBackend({
      logPath: `${runtimeDir}/fake.jsonl`,
      enabled: true,
    });
    const caps = await audio.detect();
    const daemon = new Daemon({
      ...iso,
      idleMs: 60_000,
      audioBackend: audio,
      backendCapabilities: caps,
      backendProbes: [{ tier: "fake", name: "fake", present: true }],
    });
    await daemon.start();
    cleanups.push(async () => daemon.shutdown());
    const client = new ControlPipeClient({ path: daemon.controlPath });
    cleanups.push(() => {
      client.close();
      return Promise.resolve();
    });
    const status = await client.request({ v: PROTOCOL_VERSION, op: "status", id: "be" });
    expect(status.result).toMatchObject({
      backend: { tier: "fake", available: true, loop: true, fade: true, runtimeVolume: true },
      backendProbes: [{ tier: "fake", present: true }],
    });
  });

  it("socket bind is the spawn mutex — second listener loses the race", async () => {
    const runtimeDir = await tempRuntime();
    const iso = daemonIsolationOptions(runtimeDir);
    const a = new Daemon({ ...iso, idleMs: 60_000 });
    expect(await a.start()).toEqual({ status: "listening" });
    cleanups.push(async () => a.shutdown());

    const b = new Daemon({ ...iso, idleMs: 60_000 });
    expect(await b.start()).toEqual({ status: "lost-race" });
  });

  it("does not idle-exit while a client connection is open (cold-start guard)", async () => {
    let exited = false;
    const daemon = await startIsolatedDaemon({
      idleMs: 80,
      onIdleExit: () => {
        exited = true;
      },
    });
    await daemon.start();
    cleanups.push(async () => daemon.shutdown());

    const client = new ControlPipeClient({ path: daemon.controlPath });
    await client.ensureConnected();
    cleanups.push(() => {
      client.close();
      return Promise.resolve();
    });

    await new Promise((r) => setTimeout(r, 200));
    expect(exited).toBe(false);
    expect(daemon.connectionCount).toBeGreaterThan(0);

    client.close();
    await new Promise((r) => setTimeout(r, 250));
    expect(exited).toBe(true);
  });

  it("shutdown message tears down socket and pidfile", async () => {
    const daemon = await startIsolatedDaemon();
    await daemon.start();
    const path = daemon.controlPath;
    const runtimeDir = daemon.getRuntimeDir();

    const client = new ControlPipeClient({ path });
    const reply = await client.request({ v: PROTOCOL_VERSION, op: "shutdown", id: "bye" });
    expect(reply.ok).toBe(true);
    client.close();

    await new Promise((r) => setTimeout(r, 50));
    expect(readPidfile(runtimeDir)).toBeNull();

    const { connectWithRetry } = await import("../src/control/client.js");
    await expect(connectWithRetry({ path, timeoutMs: 200, retryDelayMs: 20 })).rejects.toBeTruthy();
  });

  it("ensureDaemonRunning spawns detached with stdio ignored and holds client", async () => {
    const runtimeDir = await tempRuntime();
    const iso = daemonIsolationOptions(runtimeDir);
    const spawnImpl = vi.fn(() => {
      const child = {
        unref: vi.fn(),
        pid: 4242,
      } as unknown as ChildProcess;
      void (async () => {
        const d = new Daemon({ ...iso, idleMs: 60_000 });
        await d.start();
        cleanups.push(async () => d.shutdown());
      })();
      return child;
    });

    const result = await ensureDaemonRunning({
      ...iso,
      spawnImpl: spawnImpl as unknown as typeof import("node:child_process").spawn,
      connectTimeoutMs: 3000,
    });
    cleanups.push(() => {
      result.client.close();
      return Promise.resolve();
    });

    expect(spawnImpl).toHaveBeenCalled();
    const call = spawnImpl.mock.calls[0] as unknown as [
      string,
      string[],
      { detached: boolean; stdio: string },
    ];
    expect(call[2]).toMatchObject({ detached: true, stdio: "ignore" });
    expectPlatformControlPath(result.path);
    expect(result.client).toBeTruthy();
    const status = await result.client.request({
      v: PROTOCOL_VERSION,
      op: "status",
      id: "held",
    });
    expect(status.ok).toBe(true);
  });

  it("held ensureDaemon client blocks idle-exit until close (spawn-then-delayed-message)", async () => {
    let exited = false;
    const runtimeDir = await tempRuntime();
    const iso = daemonIsolationOptions(runtimeDir);
    const daemon = new Daemon({
      ...iso,
      idleMs: 80,
      onIdleExit: () => {
        exited = true;
      },
    });
    await daemon.start();
    cleanups.push(async () => daemon.shutdown());

    const ensured = await ensureDaemonRunning({ ...iso, probeTimeoutMs: 500 });
    cleanups.push(() => {
      ensured.client.close();
      return Promise.resolve();
    });

    await new Promise((r) => setTimeout(r, 200));
    expect(exited).toBe(false);

    await ensured.client.send({ v: PROTOCOL_VERSION, op: "start", sessionId: "late" });
    await new Promise((r) => setTimeout(r, 30));
    expect(daemon.sessionCount).toBe(1);

    ensured.client.close();
    await daemon.shutdown();
  });
});
