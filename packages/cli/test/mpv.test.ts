import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import type { Socket } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { applyVolumeForTier } from "../src/audio/perceptual.js";
import { MpvAudioBackend } from "../src/audio/mpv/index.js";
import { detectMpvPresent, selectAudioBackend } from "../src/audio/detect.js";
import { Daemon } from "../src/daemon/Daemon.js";
import { PlaybackController } from "../src/session/PlaybackController.js";
import { ControlPipeClient } from "../src/control/client.js";
import { PROTOCOL_VERSION } from "../src/control/protocol.js";
import { daemonIsolationOptions } from "./helpers/controlEndpoint.js";

function mockChild(): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  child.kill = vi.fn(() => {
    queueMicrotask(() => {
      Object.defineProperty(child, "exitCode", { value: 0, configurable: true });
      child.emit("exit", 0, null);
    });
    return true;
  });
  Object.defineProperty(child, "exitCode", { value: null, writable: true, configurable: true });
  Object.defineProperty(child, "killed", { value: false, writable: true });
  return child;
}

function mockSocket(writes: string[], child?: ChildProcess): Socket {
  const sock = new EventEmitter() as Socket;
  sock.write = vi.fn((data: string, cb?: (err?: Error | null) => void) => {
    writes.push(String(data));
    cb?.(null);
    if (child && String(data).includes('"quit"')) {
      queueMicrotask(() => {
        Object.defineProperty(child, "exitCode", { value: 0, configurable: true });
        child.emit("exit", 0, null);
      });
    }
    return true;
  }) as Socket["write"];
  sock.destroy = vi.fn() as Socket["destroy"];
  Object.defineProperty(sock, "destroyed", { value: false, writable: true });
  Object.defineProperty(sock, "connecting", { value: false, writable: true });
  return sock;
}

describe("MpvAudioBackend (PC-303)", () => {
  it("detect is unavailable when mpv is not on PATH", async () => {
    const backend = new MpvAudioBackend({
      env: { PATH: "/no/mpv/here" },
      isPresent: () => false,
    });
    await expect(backend.detect()).resolves.toMatchObject({
      available: false,
      name: "mpv",
    });
  });

  it("detect reports full capabilities when present", async () => {
    const backend = new MpvAudioBackend({ isPresent: () => true, mpvPath: "/usr/bin/mpv" });
    await expect(backend.detect()).resolves.toEqual({
      available: true,
      tier: "mpv",
      name: "mpv",
      loop: true,
      fade: true,
      runtimeVolume: true,
    });
  });

  it("passes perceptual volume through (no double-map)", () => {
    expect(applyVolumeForTier("mpv", 40)).toEqual({
      mode: "perceptual-pass-through",
      perceptual: 40,
    });
  });

  it("play/setVolume/stop use IPC with perceptual volume and loop flags", async () => {
    const writes: string[] = [];
    const child = mockChild();
    const socket = mockSocket(writes, child);
    const spawnArgs: string[][] = [];
    const spawnFn = ((_cmd: string, args: readonly string[]): ChildProcess => {
      spawnArgs.push([...args]);
      return child;
    }) as unknown as typeof import("node:child_process").spawn;

    const backend = new MpvAudioBackend({
      mpvPath: "/mock/mpv",
      isPresent: () => true,
      spawnFn,
      connectFn: () => socket,
      waitForIpc: () => Promise.resolve(),
      fadeSteps: 2,
    });

    const handle = await backend.play({
      soundPath: "/tmp/sleepy.ogg",
      volume: 40,
      fadeInMs: 0,
    });

    expect(spawnArgs).toHaveLength(1);
    const args = spawnArgs[0]!;
    expect(args).toContain("--loop=inf");
    expect(args).toContain("--no-video");
    expect(args).toContain("--osd-level=0");
    expect(args.some((a) => a.startsWith("--input-ipc-server="))).toBe(true);

    await backend.setVolume(handle, 70);
    await backend.stop(handle, 0);

    const payloads = writes.map((w) => JSON.parse(w.trim()) as { command: unknown[] });
    expect(payloads.some((p) => p.command[0] === "set_property" && p.command[2] === 40)).toBe(true);
    expect(payloads.some((p) => p.command[0] === "set_property" && p.command[2] === 70)).toBe(true);
    expect(payloads.some((p) => p.command[0] === "quit")).toBe(true);
  });

  it("fade-cancel: play during stop restores perceptual volume", async () => {
    const writes: string[] = [];
    const child = mockChild();
    const socket = mockSocket(writes, child);
    const backend = new MpvAudioBackend({
      mpvPath: "/mock/mpv",
      isPresent: () => true,
      spawnFn: (() => child) as unknown as typeof import("node:child_process").spawn,
      connectFn: () => socket,
      waitForIpc: () => Promise.resolve(),
      fadeSteps: 4,
    });

    const handle = await backend.play({ soundPath: "/x.ogg", volume: 50, fadeInMs: 0 });
    const stopP = backend.stop(handle, 200);
    await new Promise((r) => setTimeout(r, 20));
    const handle2 = await backend.play({ soundPath: "/x.ogg", volume: 50, fadeInMs: 0 });
    expect(handle2.id).toBe(handle.id);
    await stopP;
    await backend.stop(handle2, 0);
  });

  it("selectAudioBackend picks mpv when factory is provided and higher tiers absent", async () => {
    const selected = await selectAudioBackend({
      env: {},
      isFakePresent: () => false,
      isSidecarPresent: () => false,
      isMpvPresent: () => true,
      createMpv: () => new MpvAudioBackend({ isPresent: () => true, mpvPath: "/mock/mpv" }),
    });
    expect(selected.capabilities.tier).toBe("mpv");
  });
});

describe.skipIf(!detectMpvPresent())("e2e mpv (PC-303, mpv-present guard)", () => {
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

  it("lifecycle start → stop through daemon", async () => {
    const runtimeDir = await mkdtemp(join(tmpdir(), "purrcode-e2e-mpv-"));
    cleanups.push(async () => rm(runtimeDir, { recursive: true, force: true }));
    const soundPath = join(process.cwd(), "sounds/sleepy.ogg");
    const backend = new MpvAudioBackend({ fadeSteps: 4 });
    const playback = new PlaybackController({
      backend,
      soundPath,
      fadeOutMs: 80,
      fadeInMs: 0,
      volume: 30,
    });
    const iso = daemonIsolationOptions(runtimeDir);
    const daemon = new Daemon({
      ...iso,
      idleMs: 60_000,
      audioBackend: backend,
      playback,
      backendCapabilities: await backend.detect(),
    });
    await daemon.start();
    cleanups.push(async () => daemon.shutdown());
    const client = new ControlPipeClient({ path: daemon.controlPath });
    cleanups.push(() => {
      client.close();
      return Promise.resolve();
    });

    await client.send({ v: PROTOCOL_VERSION, op: "start", sessionId: "m1" });
    await new Promise((r) => setTimeout(r, 200));
    const status = await client.request({ v: PROTOCOL_VERSION, op: "status", id: "s" });
    expect(status.result).toMatchObject({ sessions: 1 });
    await client.send({ v: PROTOCOL_VERSION, op: "stop", sessionId: "m1" });
    await new Promise((r) => setTimeout(r, 300));
  }, 20_000);
});
