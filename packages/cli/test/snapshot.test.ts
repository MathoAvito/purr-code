import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  filterLiveSessions,
  loadRegistrySnapshot,
  snapshotPath,
  writeRegistrySnapshot,
} from "../src/session/snapshot.js";
import type { SessionRecord } from "../src/session/SessionRegistry.js";
import { Daemon } from "../src/daemon/Daemon.js";
import { ControlPipeClient } from "../src/control/client.js";
import { PROTOCOL_VERSION } from "../src/control/protocol.js";
import { daemonIsolationOptions } from "./helpers/controlEndpoint.js";

const sample = (id: string, pid?: number): SessionRecord => {
  const t = Date.now();
  return {
    sessionId: id,
    startedAt: t,
    lastSeenAt: t,
    ...(pid !== undefined ? { claudePid: pid } : {}),
  };
};

describe("registry snapshot (PC-106)", () => {
  it("writes atomically and reloads", async () => {
    const dir = await mkdtemp(join(tmpdir(), "purrcode-snap-"));
    try {
      writeRegistrySnapshot(dir, [sample("a", process.pid)]);
      const loaded = loadRegistrySnapshot(dir);
      expect(loaded.ok).toBe(true);
      if (loaded.ok) {
        expect(loaded.snapshot.sessions[0]?.sessionId).toBe("a");
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("treats truncated / wrong-schema JSON as corrupt (no throw)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "purrcode-snap-bad-"));
    try {
      await writeFile(snapshotPath(dir), "{not json", "utf8");
      expect(loadRegistrySnapshot(dir)).toEqual({ ok: false, reason: "corrupt" });

      await writeFile(snapshotPath(dir), JSON.stringify({ v: 99, sessions: [] }), "utf8");
      expect(loadRegistrySnapshot(dir)).toEqual({ ok: false, reason: "corrupt" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("filters dead-PID entries", () => {
    const live = filterLiveSessions(
      [sample("alive", process.pid), sample("dead", 1_999_999_999), sample("unknown")],
      (pid) => pid === process.pid,
    );
    expect(live.map((s) => s.sessionId)).toEqual(["alive", "unknown"]);
  });

  it("daemon restores live snapshot on boot", async () => {
    const dir = await mkdtemp(join(tmpdir(), "purrcode-snap-boot-"));
    try {
      writeRegistrySnapshot(dir, [sample("keep", process.pid), sample("gone", 1_999_999_999)]);
      const iso = daemonIsolationOptions(dir);
      const daemon = new Daemon({ ...iso, idleMs: 60_000 });
      await daemon.start();
      expect(daemon.sessionCount).toBe(1);
      expect(daemon.getSessionRegistry().get("keep")).toBeTruthy();

      const client = new ControlPipeClient({ path: daemon.controlPath });
      await client.send({ v: PROTOCOL_VERSION, op: "start", sessionId: "keep" });
      await new Promise((r) => setTimeout(r, 80));
      await daemon.shutdown();
      client.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("shutdown snapshots active sessions before teardown (not empty wipe)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "purrcode-snap-shutdown-"));
    try {
      const iso = daemonIsolationOptions(dir);
      const daemon = new Daemon({ ...iso, idleMs: 60_000 });
      await daemon.start();
      const client = new ControlPipeClient({ path: daemon.controlPath });
      await client.send({
        v: PROTOCOL_VERSION,
        op: "start",
        sessionId: "live",
        claudePid: process.pid,
      });
      await new Promise((r) => setTimeout(r, 80));
      expect(daemon.sessionCount).toBe(1);
      await daemon.shutdown();
      client.close();

      const loaded = loadRegistrySnapshot(dir);
      expect(loaded.ok).toBe(true);
      if (loaded.ok) {
        expect(loaded.snapshot.sessions.map((s) => s.sessionId)).toEqual(["live"]);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
