import { chmodSync, unlinkSync, existsSync } from "node:fs";
import net from "node:net";

import {
  PROTOCOL_VERSION,
  encodeControlMessage,
  isRequestOp,
  parseControlMessage,
  type ControlRequest,
  type ControlResponse,
} from "./protocol.js";

export type ControlMessageHandler = (
  message: ControlRequest,
) =>
  | void
  | ControlResponse
  | { ok: boolean; error?: string; result?: unknown }
  | Promise<void | ControlResponse | { ok: boolean; error?: string; result?: unknown }>;

export type ControlPipeServerOptions = {
  path: string;
  kind: "uds" | "named-pipe";
  onMessage: ControlMessageHandler;
  /** Called when a line is rejected; must not throw. */
  onReject?: (info: { error: string; detail: string }) => void;
  /** Fired whenever open connection count changes (idle-exit pin). */
  onConnectionCount?: (count: number) => void;
  /**
   * When true (default for UDS), do not unlink before listen — use bind-as-mutex
   * (EADDRINUSE → probe → lose race or reclaim stale). Named pipes skip unlink.
   */
  reclaimStaleSocket?: boolean;
};

export type ListenResult = { status: "listening" } | { status: "lost-race" };

/**
 * Duplex control-pipe server (UDS / Windows named pipe).
 * Malformed or oversized lines are rejected without crashing the process.
 */
export class ControlPipeServer {
  private readonly path: string;
  private readonly kind: "uds" | "named-pipe";
  private readonly onMessage: ControlMessageHandler;
  private readonly onReject: ControlPipeServerOptions["onReject"];
  private readonly onConnectionCount: ((count: number) => void) | undefined;
  private readonly reclaimStaleSocket: boolean;
  private server: net.Server | null = null;
  private readonly sockets = new Set<net.Socket>();

  constructor(options: ControlPipeServerOptions) {
    this.path = options.path;
    this.kind = options.kind;
    this.onMessage = options.onMessage;
    this.onReject = options.onReject;
    this.onConnectionCount = options.onConnectionCount;
    this.reclaimStaleSocket = options.reclaimStaleSocket ?? true;
  }

  get addressPath(): string {
    return this.path;
  }

  get connectionCount(): number {
    return this.sockets.size;
  }

  /**
   * Bind the control pipe. Uses socket-bind-as-mutex on UDS (ADR 0003 / PC-104):
   * EADDRINUSE + live peer → `{ status: "lost-race" }`; stale socket → reclaim.
   */
  async listen(): Promise<ListenResult> {
    const server = net.createServer((socket) => this.accept(socket));
    this.server = server;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await this.bindOnce(server);
        if (this.kind === "uds") {
          try {
            chmodSync(this.path, 0o600);
          } catch {
            // Best-effort
          }
        }
        return { status: "listening" };
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== "EADDRINUSE" || this.kind !== "uds" || !this.reclaimStaleSocket) {
          this.server = null;
          throw err;
        }
        const live = await probeLive(this.path);
        if (live) {
          server.close();
          this.server = null;
          return { status: "lost-race" };
        }
        try {
          unlinkSync(this.path);
        } catch {
          // retry bind once
        }
      }
    }
    this.server = null;
    throw new Error(`failed to bind control pipe: ${this.path}`);
  }

  async close(): Promise<void> {
    for (const s of this.sockets) {
      s.destroy();
    }
    this.sockets.clear();
    this.emitConnections();
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (this.kind === "uds" && existsSync(this.path)) {
      try {
        unlinkSync(this.path);
      } catch {
        // ignore
      }
    }
  }

  private bindOnce(server: net.Server): Promise<void> {
    return new Promise((resolve, reject) => {
      const onError = (err: Error) => {
        server.off("error", onError);
        reject(err);
      };
      server.once("error", onError);
      server.listen(this.path, () => {
        server.off("error", onError);
        resolve();
      });
    });
  }

  private accept(socket: net.Socket): void {
    this.sockets.add(socket);
    this.emitConnections();
    let buffer = "";
    socket.setEncoding("utf8");

    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (buffer.length > 2 * 1024 * 1024) {
        this.onReject?.({ error: "too-large", detail: "connection buffer exceeded" });
        socket.destroy();
        return;
      }
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        void this.handleLine(socket, line);
      }
    });

    const cleanup = () => {
      if (this.sockets.delete(socket)) this.emitConnections();
    };
    socket.on("close", cleanup);
    socket.on("error", cleanup);
  }

  private emitConnections(): void {
    this.onConnectionCount?.(this.sockets.size);
  }

  private async handleLine(socket: net.Socket, line: string): Promise<void> {
    const parsed = parseControlMessage(line);
    if (!parsed.ok) {
      this.onReject?.({ error: parsed.error, detail: parsed.detail });
      if (parsed.id) {
        const nack: ControlResponse = {
          v: PROTOCOL_VERSION,
          id: parsed.id,
          ok: false,
          error: parsed.error,
        };
        socket.write(encodeControlMessage(nack));
      }
      return;
    }

    try {
      const result = await this.onMessage(parsed.message);
      if (isRequestOp(parsed.message.op)) {
        const id = "id" in parsed.message ? parsed.message.id : undefined;
        let response: ControlResponse;
        if (result && typeof result === "object" && "ok" in result) {
          const r = result as ControlResponse;
          response = {
            v: PROTOCOL_VERSION,
            id,
            ok: r.ok,
            ...(r.error !== undefined ? { error: r.error } : {}),
            ...("result" in r ? { result: r.result } : {}),
          };
        } else {
          response = { v: PROTOCOL_VERSION, id, ok: true, result: result ?? null };
        }
        socket.write(encodeControlMessage(response));
      }
    } catch (err) {
      if (isRequestOp(parsed.message.op) && "id" in parsed.message) {
        const response: ControlResponse = {
          v: PROTOCOL_VERSION,
          id: parsed.message.id,
          ok: false,
          error: err instanceof Error ? err.message : "handler error",
        };
        socket.write(encodeControlMessage(response));
      }
    }
  }
}

function probeLive(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.connect(path);
    const done = (live: boolean) => {
      probe.removeAllListeners();
      probe.destroy();
      resolve(live);
    };
    probe.once("connect", () => done(true));
    probe.once("error", () => done(false));
  });
}
