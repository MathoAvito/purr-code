import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { NativeAudioBackend } from "../src/audio/native/index.js";
import { selectAudioBackend } from "../src/audio/detect.js";

function tinyWav(): Buffer {
  const dataSize = 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(48000, 24);
  buf.writeUInt32LE(96000, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  return buf;
}

function mockChild(exitsQuickly = true): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  child.kill = vi.fn(() => {
    Object.defineProperty(child, "exitCode", { value: 0, configurable: true });
    queueMicrotask(() => child.emit("exit", 0, null));
    return true;
  });
  Object.defineProperty(child, "exitCode", { value: null, writable: true, configurable: true });
  Object.defineProperty(child, "killed", { value: false, writable: true });
  if (exitsQuickly) {
    queueMicrotask(() => {
      Object.defineProperty(child, "exitCode", { value: 0, configurable: true });
      child.emit("exit", 0, null);
    });
  }
  return child;
}

describe("NativeAudioBackend (PC-304)", () => {
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

  it("reports seamed capabilities (no fade / no runtime volume)", async () => {
    const backend = new NativeAudioBackend({
      platform: "linux",
      isPresent: () => true,
      resolvePlayer: () => ({ kind: "aplay", bin: "aplay" }),
    });
    await expect(backend.detect()).resolves.toEqual({
      available: true,
      tier: "native",
      name: "aplay",
      loop: false,
      fade: false,
      runtimeVolume: false,
    });
  });

  it("always plays the WAV cache path, never the original OGG", async () => {
    const home = await mkdtemp(join(tmpdir(), "purr-native-"));
    cleanups.push(async () => rm(home, { recursive: true, force: true }));
    const ogg = join(home, "sleepy.ogg");
    const twin = join(home, "sleepy.wav");
    await writeFile(ogg, Buffer.from("OggS"));
    await writeFile(twin, tinyWav());

    const spawned: string[][] = [];
    let childCount = 0;
    const spawnFn = ((bin: string, args: readonly string[]) => {
      spawned.push([bin, ...args]);
      childCount++;
      // First child exits to prove respawn; second hangs until stop.
      return mockChild(childCount === 1);
    }) as unknown as typeof import("node:child_process").spawn;

    const backend = new NativeAudioBackend({
      platform: "linux",
      env: { XDG_DATA_HOME: join(home, "data"), PATH: "/usr/bin" },
      isPresent: () => true,
      resolvePlayer: () => ({ kind: "aplay", bin: "/usr/bin/aplay" }),
      spawnFn,
      ensureWav: () =>
        Promise.resolve({
          wavPath: twin,
          created: false,
          method: "sibling-twin" as const,
        }),
    });

    const handle = await backend.play({ soundPath: ogg, volume: 50 });
    await new Promise((r) => setTimeout(r, 30));
    expect(spawned.length).toBeGreaterThanOrEqual(1);
    expect(spawned[0]![0]).toBe("/usr/bin/aplay");
    expect(spawned[0]).toContain(twin);
    expect(spawned[0]).not.toContain(ogg);

    // Respawn happened (seamed loop).
    expect(spawned.length).toBeGreaterThanOrEqual(2);

    await backend.stop(handle, 100);
    const after = spawned.length;
    await new Promise((r) => setTimeout(r, 40));
    expect(spawned.length).toBe(after); // no further respawns after stop
  });

  it("selectAudioBackend can pick native when higher tiers absent", async () => {
    const selected = await selectAudioBackend({
      env: {},
      platform: "linux",
      isFakePresent: () => false,
      isSidecarPresent: () => false,
      isMpvPresent: () => false,
      isNativePresent: () => true,
      createNative: () =>
        new NativeAudioBackend({
          isPresent: () => true,
          resolvePlayer: () => ({ kind: "aplay", bin: "aplay" }),
        }),
    });
    expect(selected.capabilities.tier).toBe("native");
    expect(selected.capabilities.fade).toBe(false);
  });
});
