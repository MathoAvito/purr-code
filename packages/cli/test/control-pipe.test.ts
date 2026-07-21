import { afterEach, describe, expect, it } from "vitest";

import {
  ControlPipeClient,
  ControlPipeServer,
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  connectWithRetry,
  parseControlMessage,
  resolveControlPipePath,
  resolveWindowsPipeSuffix,
  type ControlRequest,
} from "../src/control/index.js";
import { createTestControlEndpoint } from "./helpers/controlEndpoint.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("parseControlMessage", () => {
  it("accepts a valid start message", () => {
    const parsed = parseControlMessage(
      JSON.stringify({ v: 1, op: "start", sessionId: "abc", claudePid: 42 }),
    );
    expect(parsed).toEqual({
      ok: true,
      message: { v: 1, op: "start", sessionId: "abc", claudePid: 42 },
    });
  });

  it("rejects invalid JSON without throwing", () => {
    expect(parseControlMessage("{nope")).toMatchObject({ ok: false, error: "invalid-json" });
  });

  it("rejects oversized messages", () => {
    const huge = "x".repeat(MAX_MESSAGE_BYTES + 1);
    expect(parseControlMessage(huge)).toMatchObject({ ok: false, error: "too-large" });
  });

  it("rejects unknown ops and bad schema", () => {
    expect(parseControlMessage(JSON.stringify({ v: 1, op: "explode" }))).toMatchObject({
      ok: false,
      error: "invalid-schema",
    });
    expect(parseControlMessage(JSON.stringify({ v: 1, op: "start" }))).toMatchObject({
      ok: false,
      error: "invalid-schema",
    });
    expect(
      parseControlMessage(JSON.stringify({ v: 1, op: "volume", id: "1", value: 101 })),
    ).toMatchObject({ ok: false, error: "invalid-schema" });
  });

  it("preserves request id on schema failure for NACK", () => {
    expect(parseControlMessage(JSON.stringify({ v: 99, op: "status", id: "req-1" }))).toMatchObject(
      { ok: false, id: "req-1" },
    );
  });
});

describe("resolveControlPipePath / Windows suffix", () => {
  it("embeds SID when whoami returns one", () => {
    expect(resolveWindowsPipeSuffix({ USERNAME: "me" }, () => '"user","S-1-5-21-1"\n')).toBe(
      "S-1-5-21-1",
    );
  });

  it("falls back to USERNAME", () => {
    expect(resolveWindowsPipeSuffix({ USERNAME: "me" }, () => "")).toBe("me");
  });

  it("Unix path is runtimeDir/control.sock", async () => {
    const base = await mkdtemp(join(tmpdir(), "purrcode-pipe-"));
    try {
      const resolved = await resolveControlPipePath({
        platform: "linux",
        runtimeDir: base,
      });
      expect(resolved.kind).toBe("uds");
      expect(resolved.path).toBe(join(base, "control.sock"));
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("Windows path embeds suffix and is not under runtimeDir", async () => {
    const base = await mkdtemp(join(tmpdir(), "purrcode-pipe-win-"));
    try {
      const resolved = await resolveControlPipePath({
        platform: "win32",
        runtimeDir: base,
        windowsPipeSuffix: "S-1-5-21-9",
      });
      expect(resolved.kind).toBe("named-pipe");
      expect(resolved.path).toBe("\\\\.\\pipe\\purrcode-S-1-5-21-9");
      expect(resolved.path).not.toContain(base);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});

describe("ControlPipeServer + Client", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length) {
      await cleanups.pop()?.();
    }
  });

  /** Platform-correct control server (UDS on Unix, named pipe on Windows). */
  async function withControlServer(
    handler: (msg: ControlRequest) => void | { ok: boolean; result?: unknown },
  ): Promise<{ path: string; rejects: Array<{ error: string; detail: string }> }> {
    const endpoint = await createTestControlEndpoint("ctrl");
    const rejects: Array<{ error: string; detail: string }> = [];
    const server = new ControlPipeServer({
      path: endpoint.path,
      kind: endpoint.kind,
      onMessage: (msg) => handler(msg),
      onReject: (info) => rejects.push(info),
    });
    await server.listen();
    cleanups.push(async () => {
      await server.close();
      await endpoint.cleanup();
    });
    return { path: endpoint.path, rejects };
  }

  it("round-trips status request/response and fire-and-forget start", async () => {
    const seen: ControlRequest[] = [];
    const { path } = await withControlServer((msg) => {
      seen.push(msg);
      if (msg.op === "status") return { ok: true, result: { sessions: 0 } };
    });

    const client = new ControlPipeClient({ path });
    cleanups.push(() => {
      client.close();
      return Promise.resolve();
    });

    await client.send({
      v: PROTOCOL_VERSION,
      op: "start",
      sessionId: "s1",
      claudePid: 9,
    });
    const reply = await client.request({ v: PROTOCOL_VERSION, op: "status", id: "r1" });
    expect(reply).toMatchObject({ ok: true, id: "r1", result: { sessions: 0 } });
    expect(seen.map((m) => m.op)).toEqual(["start", "status"]);
  });

  it("rejects malformed and oversized lines without crashing", async () => {
    const { path, rejects } = await withControlServer(() => ({ ok: true }));
    const client = new ControlPipeClient({ path });
    cleanups.push(() => {
      client.close();
      return Promise.resolve();
    });
    const socket = await client.ensureConnected();

    socket.write("not-json\n");
    socket.write("x".repeat(MAX_MESSAGE_BYTES + 10) + "\n");

    const reply = await client.request({ v: PROTOCOL_VERSION, op: "status", id: "ok-1" });
    expect(reply.ok).toBe(true);
    expect(rejects.some((r) => r.error === "invalid-json")).toBe(true);
    expect(rejects.some((r) => r.error === "too-large")).toBe(true);
  });

  it("connectWithRetry waits until the server listens", async () => {
    const endpoint = await createTestControlEndpoint("retry");
    cleanups.push(endpoint.cleanup);

    const connectPromise = connectWithRetry({
      path: endpoint.path,
      timeoutMs: 2000,
      retryDelayMs: 20,
    });
    await new Promise((r) => setTimeout(r, 50));
    const server = new ControlPipeServer({
      path: endpoint.path,
      kind: endpoint.kind,
      onMessage: () => ({ ok: true }),
    });
    await server.listen();
    cleanups.push(async () => server.close());

    const socket = await connectPromise;
    expect(socket.destroyed).toBe(false);
    socket.destroy();
  });
});
