import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ensureWavCache,
  isWavBuffer,
  isWavFile,
  sanitizeSoundName,
} from "../src/audio/wavCache.js";
import { resolveSidecarBinaryPath } from "../src/audio/sidecar/index.js";

/** Minimal mono 16-bit PCM WAV (1 frame of silence). */
function tinyWav(): Buffer {
  const dataSize = 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(48000, 24);
  buf.writeUInt32LE(48000 * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  return buf;
}

describe("WAV cache (PC-304)", () => {
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
    const home = await mkdtemp(join(tmpdir(), "purr-wav-"));
    cleanups.push(async () => rm(home, { recursive: true, force: true }));
    return home;
  }

  it("sanitizes sound names", () => {
    expect(sanitizeSoundName("Sleepy Cat!")).toBe("sleepy-cat");
    expect(sanitizeSoundName("../../../etc")).toBe("etc");
  });

  it("detects WAV magic bytes", () => {
    expect(isWavBuffer(tinyWav())).toBe(true);
    expect(isWavBuffer(Buffer.from("OggS....WAVE"))).toBe(false);
  });

  it("copies a WAV source into the data dir (idempotent)", async () => {
    const home = await tempHome();
    const src = join(home, "src.wav");
    await writeFile(src, tinyWav());

    const first = await ensureWavCache({
      sourcePath: src,
      soundName: "tiny",
      home,
      platform: "linux",
      env: { XDG_DATA_HOME: join(home, "data") },
      sidecarBin: null,
    });
    expect(first.created).toBe(true);
    expect(first.method).toBe("copy-wav");
    expect(await isWavFile(first.wavPath)).toBe(true);

    const second = await ensureWavCache({
      sourcePath: src,
      soundName: "tiny",
      home,
      platform: "linux",
      env: { XDG_DATA_HOME: join(home, "data") },
      sidecarBin: null,
    });
    expect(second.created).toBe(false);
    expect(second.method).toBe("cached");
    expect(second.wavPath).toBe(first.wavPath);
  });

  it("falls back to sibling twin when sidecar disabled", async () => {
    const home = await tempHome();
    const ogg = join(home, "purr.ogg");
    const twin = join(home, "purr.wav");
    await writeFile(ogg, Buffer.from("OggS-not-really"));
    await writeFile(twin, tinyWav());

    const result = await ensureWavCache({
      sourcePath: ogg,
      soundName: "purr",
      home,
      platform: "linux",
      env: { XDG_DATA_HOME: join(home, "data") },
      sidecarBin: null,
      allowSiblingTwin: true,
    });
    expect(result.method).toBe("sibling-twin");
    expect(await isWavFile(result.wavPath)).toBe(true);
  });

  const sidecar = resolveSidecarBinaryPath();
  it.skipIf(!sidecar)(
    "exports OGG→WAV via sidecar --export",
    async () => {
      const home = await tempHome();
      const sourcePath = join(process.cwd(), "sounds/sleepy.ogg");

      const result = await ensureWavCache({
        sourcePath,
        soundName: "sleepy-export-test",
        home,
        platform: "linux",
        env: { XDG_DATA_HOME: join(home, "data") },
        sidecarBin: sidecar!,
        allowSiblingTwin: false,
      });
      expect(result.method).toBe("sidecar-export");
      expect(await isWavFile(result.wavPath)).toBe(true);
      const head = await readFile(result.wavPath);
      expect(isWavBuffer(head)).toBe(true);

      const again = await ensureWavCache({
        sourcePath,
        soundName: "sleepy-export-test",
        home,
        platform: "linux",
        env: { XDG_DATA_HOME: join(home, "data") },
        sidecarBin: sidecar!,
        allowSiblingTwin: false,
      });
      expect(again.method).toBe("cached");
    },
    120_000,
  );
});
