/**
 * TDD contracts for Windows named-pipe transport (ADR 0003 / PC-103/104).
 *
 * Production: one pipe per user SID (`\\.\pipe\purrcode-<SID>`).
 * Tests: unique suffixes for isolation; never fake UDS `.sock` files on win32.
 * Bind mutex: EADDRINUSE + live peer → lost-race on both UDS and named-pipe.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ControlPipeClient, ControlPipeServer } from "../src/control/index.js";
import { PROTOCOL_VERSION } from "../src/control/protocol.js";
import { resolveControlPipePath } from "../src/control/paths.js";
import { Daemon } from "../src/daemon/Daemon.js";
import {
  createTestControlEndpoint,
  daemonIsolationOptions,
  expectPlatformControlPath,
  uniqueWindowsPipeSuffix,
} from "./helpers/controlEndpoint.js";

describe("Windows named-pipe contracts (ADR 0003)", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()?.();
  });

  it("production win32 path is SID/suffix pipe — not a filesystem .sock under runtimeDir", async () => {
    const runtimeDir = await mkdtemp(join(tmpdir(), "purrcode-win-path-"));
    cleanups.push(async () => rm(runtimeDir, { recursive: true, force: true }));

    const resolved = await resolveControlPipePath({
      platform: "win32",
      runtimeDir,
      windowsPipeSuffix: "S-1-5-21-42",
    });

    expect(resolved.kind).toBe("named-pipe");
    expect(resolved.runtimeDir).toBe(runtimeDir);
    expect(resolved.path).toBe("\\\\.\\pipe\\purrcode-S-1-5-21-42");
    expect(resolved.path).not.toContain("control.sock");
    expect(resolved.path).not.toContain(runtimeDir);
  });

  it("PURRCODE_WINDOWS_PIPE_SUFFIX isolates pipes without changing the SID default contract", async () => {
    const runtimeDir = await mkdtemp(join(tmpdir(), "purrcode-win-env-"));
    cleanups.push(async () => rm(runtimeDir, { recursive: true, force: true }));

    const a = await resolveControlPipePath({
      platform: "win32",
      runtimeDir,
      env: { PURRCODE_WINDOWS_PIPE_SUFFIX: "test-aaa" },
    });
    const b = await resolveControlPipePath({
      platform: "win32",
      runtimeDir,
      env: { PURRCODE_WINDOWS_PIPE_SUFFIX: "test-bbb" },
    });

    expect(a.path).toBe("\\\\.\\pipe\\purrcode-test-aaa");
    expect(b.path).toBe("\\\\.\\pipe\\purrcode-test-bbb");
    expect(a.path).not.toBe(b.path);
  });

  it("explicit windowsPipeSuffix wins over env", async () => {
    const runtimeDir = await mkdtemp(join(tmpdir(), "purrcode-win-opt-"));
    cleanups.push(async () => rm(runtimeDir, { recursive: true, force: true }));

    const resolved = await resolveControlPipePath({
      platform: "win32",
      runtimeDir,
      windowsPipeSuffix: "from-option",
      env: { PURRCODE_WINDOWS_PIPE_SUFFIX: "from-env" },
    });
    expect(resolved.path).toBe("\\\\.\\pipe\\purrcode-from-option");
  });

  it("named-pipe kind: live peer ⇒ lost-race (bind mutex; no stale unlink required)", async () => {
    // Use a real UDS path on Unix so Linux CI can drive the named-pipe mutex
    // branch; on Windows use a real named pipe.
    const endpoint = await createTestControlEndpoint("mutex");
    cleanups.push(endpoint.cleanup);

    // On Unix, force kind=named-pipe while binding a filesystem path so we
    // assert the Windows mutex policy (EADDRINUSE → probe → lost-race, no unlink).
    const kind = "named-pipe" as const;
    const listenPath =
      process.platform === "win32" ? endpoint.path : join(endpoint.runtimeDir!, "mutex.sock");

    const a = new ControlPipeServer({
      path: listenPath,
      kind,
      onMessage: () => ({ ok: true }),
    });
    expect(await a.listen()).toEqual({ status: "listening" });
    cleanups.push(async () => a.close());

    const b = new ControlPipeServer({
      path: listenPath,
      kind,
      onMessage: () => ({ ok: true }),
    });
    expect(await b.listen()).toEqual({ status: "lost-race" });
  });

  it("Daemon isolation options keep Windows test instances off the SID pipe", async () => {
    const runtimeDir = await mkdtemp(join(tmpdir(), "purrcode-iso-"));
    cleanups.push(async () => rm(runtimeDir, { recursive: true, force: true }));

    const iso = daemonIsolationOptions(runtimeDir);
    const daemon = new Daemon({ ...iso, idleMs: 60_000 });
    expect(await daemon.start()).toEqual({ status: "listening" });
    cleanups.push(async () => daemon.shutdown());

    expectPlatformControlPath(daemon.controlPath);
    if (process.platform === "win32") {
      expect(iso.windowsPipeSuffix).toBeTruthy();
      expect(daemon.controlPath).toContain(iso.windowsPipeSuffix);
      // Must not be the bare production SID-only pipe without our test prefix.
      expect(daemon.controlPath).toMatch(/purrcode-d-/);
    }

    const client = new ControlPipeClient({ path: daemon.controlPath });
    cleanups.push(() => {
      client.close();
      return Promise.resolve();
    });
    const status = await client.request({ v: PROTOCOL_VERSION, op: "status", id: "iso" });
    expect(status.ok).toBe(true);
  });

  it("two Daemons with different windowsPipeSuffix do not collide", async () => {
    const dirA = await mkdtemp(join(tmpdir(), "purrcode-a-"));
    const dirB = await mkdtemp(join(tmpdir(), "purrcode-b-"));
    cleanups.push(async () => rm(dirA, { recursive: true, force: true }));
    cleanups.push(async () => rm(dirB, { recursive: true, force: true }));

    const suffixA = uniqueWindowsPipeSuffix("a");
    const suffixB = uniqueWindowsPipeSuffix("b");

    const a = new Daemon({
      runtimeDir: dirA,
      idleMs: 60_000,
      platform: process.platform,
      windowsPipeSuffix: process.platform === "win32" ? suffixA : undefined,
      env:
        process.platform === "win32"
          ? { ...process.env, PURRCODE_WINDOWS_PIPE_SUFFIX: suffixA }
          : undefined,
    });
    const b = new Daemon({
      runtimeDir: dirB,
      idleMs: 60_000,
      platform: process.platform,
      windowsPipeSuffix: process.platform === "win32" ? suffixB : undefined,
      env:
        process.platform === "win32"
          ? { ...process.env, PURRCODE_WINDOWS_PIPE_SUFFIX: suffixB }
          : undefined,
    });

    expect(await a.start()).toEqual({ status: "listening" });
    expect(await b.start()).toEqual({ status: "listening" });
    cleanups.push(async () => a.shutdown());
    cleanups.push(async () => b.shutdown());

    if (process.platform === "win32") {
      expect(a.controlPath).not.toBe(b.controlPath);
    }
  });
});
