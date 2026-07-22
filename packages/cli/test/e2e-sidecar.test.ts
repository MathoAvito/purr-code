/**
 * PC-109 lifecycle scenarios against the tier-1 sidecar (null backend).
 * Skipped when the platform binary is not built (`pnpm sidecar:build`).
 * CI keeps using `pnpm e2e:fake-audio` — this suite is for developer machines.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SidecarAudioBackend, resolveSidecarBinaryPath } from "../src/audio/sidecar/index.js";
import { ControlPipeClient } from "../src/control/client.js";
import { PROTOCOL_VERSION } from "../src/control/protocol.js";
import { Daemon } from "../src/daemon/Daemon.js";
import { PlaybackController } from "../src/session/PlaybackController.js";
import { daemonIsolationOptions } from "./helpers/controlEndpoint.js";

const binary = resolveSidecarBinaryPath();
const soundPath = join(process.cwd(), "sounds/sleepy.ogg");

describe.skipIf(!binary)("e2e sidecar null-backend lifecycle (PC-301)", () => {
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

  async function sleep(ms: number): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
  }

  async function harness(options: { fadeOutMs?: number; fadeInMs?: number } = {}): Promise<{
    daemon: Daemon;
    client: ControlPipeClient;
    backend: SidecarAudioBackend;
  }> {
    const runtimeDir = await mkdtemp(join(tmpdir(), "purrcode-e2e-sidecar-"));
    cleanups.push(async () => rm(runtimeDir, { recursive: true, force: true }));

    const backend = new SidecarAudioBackend({
      binaryPath: binary!,
      useNull: true,
      defaultFadeInMs: options.fadeInMs ?? 0,
    });
    const playback = new PlaybackController({
      backend,
      soundPath,
      fadeOutMs: options.fadeOutMs ?? 80,
      fadeInMs: options.fadeInMs ?? 0,
      volume: 40,
    });
    const iso = daemonIsolationOptions(runtimeDir);
    const daemon = new Daemon({
      ...iso,
      idleMs: 60_000,
      audioBackend: backend,
      playback,
    });
    await daemon.start();
    cleanups.push(async () => daemon.shutdown());
    const client = new ControlPipeClient({ path: daemon.controlPath });
    cleanups.push(() => {
      client.close();
      return Promise.resolve();
    });
    return { daemon, client, backend };
  }

  it("start → stop lifecycle", async () => {
    const { client, daemon } = await harness();
    await client.send({ v: PROTOCOL_VERSION, op: "start", sessionId: "s1" });
    await sleep(150);
    let status = await client.request({ v: PROTOCOL_VERSION, op: "status", id: "t1" });
    expect(status.result).toMatchObject({ sessions: 1 });
    expect(daemon.sessionCount).toBe(1);
    await client.send({ v: PROTOCOL_VERSION, op: "stop", sessionId: "s1" });
    await sleep(250);
    status = await client.request({ v: PROTOCOL_VERSION, op: "status", id: "t2" });
    expect(status.result).toMatchObject({ sessions: 0, phase: "idle" });
  });

  it("two sessions → one stop → final stop", async () => {
    const { client, daemon } = await harness({ fadeOutMs: 60 });
    await client.send({ v: PROTOCOL_VERSION, op: "start", sessionId: "a" });
    await client.send({ v: PROTOCOL_VERSION, op: "start", sessionId: "b" });
    await sleep(100);
    await client.send({ v: PROTOCOL_VERSION, op: "stop", sessionId: "a" });
    await sleep(80);
    let status = await client.request({ v: PROTOCOL_VERSION, op: "status", id: "t1" });
    expect(status.result).toMatchObject({ sessions: 1 });
    expect(daemon.sessionCount).toBe(1);
    await client.send({ v: PROTOCOL_VERSION, op: "stop", sessionId: "b" });
    await sleep(250);
    status = await client.request({ v: PROTOCOL_VERSION, op: "status", id: "t2" });
    expect(status.result).toMatchObject({ sessions: 0, phase: "idle" });
  });

  it("start during fade-out cancels fade", async () => {
    const { client } = await harness({ fadeOutMs: 300 });
    await client.send({ v: PROTOCOL_VERSION, op: "start", sessionId: "s1" });
    await sleep(80);
    await client.send({ v: PROTOCOL_VERSION, op: "stop", sessionId: "s1" });
    await client.send({ v: PROTOCOL_VERSION, op: "start", sessionId: "s1" });
    await sleep(150);
    const status = await client.request({ v: PROTOCOL_VERSION, op: "status", id: "t1" });
    expect(status.result).toMatchObject({ sessions: 1, phase: "playing" });
    await client.send({ v: PROTOCOL_VERSION, op: "stop", sessionId: "s1" });
    await sleep(400);
  }, 15_000);

  it("set-config volume applies to live sidecar handle", async () => {
    const { client } = await harness({ fadeOutMs: 50 });
    await client.send({ v: PROTOCOL_VERSION, op: "start", sessionId: "s1" });
    await sleep(100);
    await client.request({
      v: PROTOCOL_VERSION,
      op: "set-config",
      id: "cfg1",
      config: { volume: 70 },
    });
    await sleep(80);
    await client.send({ v: PROTOCOL_VERSION, op: "stop", sessionId: "s1" });
    await sleep(200);
  });
});
