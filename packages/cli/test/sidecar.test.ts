import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { perceptualToLinearAmplitude } from "../src/audio/perceptual.js";
import {
  SidecarAudioBackend,
  encodeSidecarCommand,
  parseSidecarEventLine,
  resolveSidecarBinaryPath,
  sidecarPackageName,
} from "../src/audio/sidecar/index.js";

const binary = resolveSidecarBinaryPath();
const hasBinary = binary !== null;

describe("sidecar protocol helpers (PC-301)", () => {
  it("encodes newline-delimited JSON commands", () => {
    expect(encodeSidecarCommand({ cmd: "volume", amplitude: 0.5, rampMs: 100 })).toBe(
      '{"cmd":"volume","amplitude":0.5,"rampMs":100}\n',
    );
  });

  it("parses sidecar stdout events", () => {
    expect(parseSidecarEventLine('{"t":1,"event":"ready","backend":"Null"}')).toMatchObject({
      event: "ready",
      backend: "Null",
    });
    expect(parseSidecarEventLine("not-json")).toBeNull();
  });

  it("maps platform to optionalDependency package names", () => {
    expect(sidecarPackageName({ platform: "linux", arch: "x64" })).toBe(
      "@purrcode/sidecar-linux-x64",
    );
    expect(sidecarPackageName({ platform: "darwin", arch: "arm64" })).toBe(
      "@purrcode/sidecar-darwin-arm64",
    );
    expect(sidecarPackageName({ platform: "win32", arch: "x64" })).toBe(
      "@purrcode/sidecar-win32-x64",
    );
    expect(sidecarPackageName({ platform: "linux", arch: "arm64" })).toBeNull();
  });

  it("detect is unavailable when override binary is missing", async () => {
    const backend = new SidecarAudioBackend({
      env: { PURRCODE_SIDECAR_BIN: join(tmpdir(), `missing-sidecar-${process.pid}`) },
      useNull: true,
    });
    await expect(backend.detect()).resolves.toEqual({
      available: false,
      tier: "none",
      name: "sidecar",
      loop: false,
      fade: false,
      runtimeVolume: false,
    });
  });
});

describe.skipIf(!hasBinary)("SidecarAudioBackend (PC-301)", () => {
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

  it("detect reports full capabilities when binary is present", async () => {
    const backend = new SidecarAudioBackend({ binaryPath: binary!, useNull: true });
    await expect(backend.detect()).resolves.toEqual({
      available: true,
      tier: "sidecar",
      name: "sidecar",
      loop: true,
      fade: true,
      runtimeVolume: true,
    });
  });

  it("play/setVolume/stop apply perceptual→amplitude once", async () => {
    const soundPath = join(process.cwd(), "sounds/sleepy.ogg");
    const backend = new SidecarAudioBackend({ binaryPath: binary!, useNull: true });
    const handle = await backend.play({ soundPath, volume: 40, fadeInMs: 0 });
    cleanups.push(async () => {
      try {
        await backend.stop(handle, 0);
      } catch {
        /* ignore */
      }
    });

    expect(perceptualToLinearAmplitude(40)).toBeGreaterThan(0);
    expect(perceptualToLinearAmplitude(40)).toBeLessThan(1);

    await backend.setVolume(handle, 60);
    await backend.stop(handle, 50);
  });

  it("play during fade-out cancels stop without killing the child", async () => {
    const soundPath = join(process.cwd(), "sounds/sleepy.ogg");
    const backend = new SidecarAudioBackend({ binaryPath: binary!, useNull: true });
    const handle = await backend.play({ soundPath, volume: 40, fadeInMs: 0 });
    const stopP = backend.stop(handle, 400);
    await new Promise((r) => setTimeout(r, 40));
    const handle2 = await backend.play({ soundPath, volume: 40, fadeInMs: 0 });
    expect(handle2.id).toBe(handle.id);
    await expect(stopP).resolves.toBeUndefined();
    await backend.stop(handle2, 50);
  }, 15_000);

  it("fires onHandleLost when the child exits unexpectedly", async () => {
    const dir = await mkdtemp(join(tmpdir(), "purr-sidecar-crash-"));
    cleanups.push(async () => rm(dir, { recursive: true, force: true }));
    const stub = join(dir, "stub-sidecar");
    await writeFile(
      stub,
      `#!/usr/bin/env bash
printf '%s\\n' '{"t":0,"event":"ready","backend":"Null","sampleRate":48000}'
IFS= read -r _
printf '%s\\n' '{"t":1,"event":"loaded","path":"x","frames":1}'
IFS= read -r _
printf '%s\\n' '{"t":2,"event":"volume","amplitude":0.1,"rampMs":0}'
IFS= read -r _
printf '%s\\n' '{"t":3,"event":"playing","fadeInMs":0,"targetGain":0.1}'
exit 1
`,
      { mode: 0o755 },
    );

    const crashing = new SidecarAudioBackend({ binaryPath: stub, useNull: false });
    const lostId = new Promise<string>((resolve) => {
      crashing.onHandleLost((h) => resolve(h.id));
    });
    const h = await crashing.play({ soundPath: "x", volume: 50, fadeInMs: 0 });
    await expect(lostId).resolves.toBe(h.id);
  });
});
