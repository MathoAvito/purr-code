import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_CONFIG,
  applyConfigPatch,
  loadConfig,
  normalizeConfig,
  resolveConfigFilePath,
  writeConfig,
} from "../src/config/index.js";
import { FakeAudioBackend } from "../src/audio/fake/index.js";
import { ControlPipeClient } from "../src/control/client.js";
import { PROTOCOL_VERSION } from "../src/control/protocol.js";
import { Daemon } from "../src/daemon/Daemon.js";
import { PlaybackController } from "../src/session/PlaybackController.js";
import { daemonIsolationOptions } from "./helpers/controlEndpoint.js";

describe("config store (PC-204)", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()?.();
  });

  async function tempHome(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "purrcode-cfg-"));
    cleanups.push(async () => rm(dir, { recursive: true, force: true }));
    return dir;
  }

  it("normalizeConfig falls back per-field and preserves unknown keys", () => {
    const cfg = normalizeConfig({
      volume: 999,
      enabled: "yes",
      sound: "sleepy",
      fadeInMs: 100,
      customFuture: { nested: true },
    });
    expect(cfg.volume).toBe(DEFAULT_CONFIG.volume); // invalid → default
    expect(cfg.enabled).toBe(DEFAULT_CONFIG.enabled);
    expect(cfg.sound).toBe("sleepy");
    expect(cfg.fadeInMs).toBe(100);
    expect(cfg.customFuture).toEqual({ nested: true });
    expect(cfg.schemaVersion).toBe(DEFAULT_CONFIG.schemaVersion);
  });

  it("atomic write + load round-trip; refuses symlink target", async () => {
    const home = await tempHome();
    const opts = { platform: "linux" as const, home, env: {} };
    const path = resolveConfigFilePath(opts);

    const written = writeConfig(
      normalizeConfig({ ...DEFAULT_CONFIG, volume: 33, experimentalFlag: true }),
      opts,
    );
    expect(written.ok).toBe(true);
    const raw = await readFile(path, "utf8");
    expect(JSON.parse(raw)).toMatchObject({ volume: 33, experimentalFlag: true });

    const loaded = loadConfig(opts);
    expect(loaded.ok).toBe(true);
    expect(loaded.config.volume).toBe(33);
    expect(loaded.config.experimentalFlag).toBe(true);

    // Replace with a symlink — load/write must refuse to follow.
    await rm(path, { force: true });
    const elsewhere = join(home, "elsewhere.json");
    writeFileSync(elsewhere, JSON.stringify({ volume: 1 }), "utf8");
    mkdirSync(join(home, ".config", "purrcode"), { recursive: true });
    try {
      symlinkSync(elsewhere, path);
    } catch {
      // Some CI filesystems disallow symlinks — skip assertion.
      return;
    }
    const refused = loadConfig(opts);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toBe("symlink");
    expect(refused.config.volume).toBe(DEFAULT_CONFIG.volume);

    const writeRefused = writeConfig(DEFAULT_CONFIG, opts);
    expect(writeRefused.ok).toBe(false);
  });

  it("daemon set-config reloads stale TTL and enabled into the live loop", async () => {
    const home = await tempHome();
    const runtimeDir = await mkdtemp(join(tmpdir(), "purrcode-cfg-d-"));
    cleanups.push(async () => rm(runtimeDir, { recursive: true, force: true }));
    const logPath = join(runtimeDir, "fake.jsonl");
    const audio = new FakeAudioBackend({ logPath, enabled: true });
    const playback = new PlaybackController({ backend: audio, fadeOutMs: 50, fadeInMs: 0 });
    const iso = daemonIsolationOptions(runtimeDir);

    const daemon = new Daemon({
      ...iso,
      idleMs: 60_000,
      audioBackend: audio,
      playback,
      watchdogIntervalMs: 0,
      configDir: { home, platform: "linux", env: {} },
      config: normalizeConfig({ ...DEFAULT_CONFIG, staleSessionMinutes: 10 }),
    });
    await daemon.start();
    cleanups.push(async () => daemon.shutdown());
    const client = new ControlPipeClient({ path: daemon.controlPath });
    cleanups.push(() => {
      client.close();
      return Promise.resolve();
    });

    const res = await client.request({
      v: PROTOCOL_VERSION,
      op: "set-config",
      id: "c1",
      config: { volume: 40, enabled: false, staleSessionMinutes: 1 },
    });
    expect(res.ok).toBe(true);
    expect(daemon.getConfig().volume).toBe(40);
    expect(daemon.getConfig().enabled).toBe(false);
    expect(daemon.getConfig().staleSessionMinutes).toBe(1);

    // enabled:false → start must not leave phase playing
    await client.send({ v: PROTOCOL_VERSION, op: "start", sessionId: "s1" });
    await new Promise((r) => setTimeout(r, 40));
    expect(daemon.getSessionRegistry().size).toBe(1);
    const status = await client.request({ v: PROTOCOL_VERSION, op: "status", id: "s" });
    expect(status.result).toMatchObject({ sessions: 1, phase: "idle", enabled: false });
  });

  it("applyConfigPatch preserves unknown keys on rewrite", async () => {
    const home = await tempHome();
    const opts = { platform: "linux" as const, home, env: {} };
    const base = normalizeConfig({ ...DEFAULT_CONFIG, keepMe: "yes" });
    writeConfig(base, opts);
    const { config, written } = applyConfigPatch(base, { volume: 55 }, opts);
    expect(written).toBe(true);
    expect(config.volume).toBe(55);
    expect(config.keepMe).toBe("yes");
    const disk = JSON.parse(await readFile(resolveConfigFilePath(opts), "utf8")) as {
      keepMe?: string;
    };
    expect(disk.keepMe).toBe("yes");
  });
});
