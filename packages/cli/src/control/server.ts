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
};

/**
 * Duplex control-pipe server (UDS / Windows named pipe).
 * Malformed or oversized lines are rejected without crashing the process.
 */
export class ControlPipeServer {
  private readonly path: string;
  private readonly kind: "uds" | "named-pipe";
  private readonly onMessage: ControlMessageHandler;
  private readonly onReject?: ControlPipeServerOptions["onReject"];
  private server: net.Server | null = null;
  private readonly sockets = new Set<net.Socket>();

  constructor(options: ControlPipeServerOptions) {
    this.path = options.path;
    this.kind = options.kind;
    this.onMessage = options.onMessage;
    this.onReject = options.onReject;
  }

  get addressPath(): string {
    return this.path;
  }

  async listen(): Promise<void> {
    if (this.kind === "uds" && existsSync(this.path)) {
      try {
        unlinkSync(this.path);
      } catch {
        // bind will fail loudly if still present
      }
    }

    const server = net.createServer((socket) => this.accept(socket));
    this.server = server;

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.path, () => {
        server.off("error", reject);
        if (this.kind === "uds") {
          try {
            chmodSync(this.path, 0o600);
          } catch {
            // Best-effort; ownership of parent dir is the primary control.
          }
        }
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    for (const s of this.sockets) {
      s.destroy();
    }
    this.sockets.clear();
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

  private accept(socket: net.Socket): void {
    this.sockets.add(socket);
    let buffer = "";
    socket.setEncoding("utf8");

    socket.on("data", (chunk: string) => {
      buffer += chunk;
      // Soft cap on buffer growth from a slow/malicious peer.
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

    const cleanup = () => this.sockets.delete(socket);
    socket.on("close", cleanup);
    socket.on("error", cleanup);
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
      // Never rethrow — keep the daemon alive (PC-103).
    }
  }
}
