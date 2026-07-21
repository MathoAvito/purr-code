import net from "node:net";
import { randomUUID } from "node:crypto";

import {
  PROTOCOL_VERSION,
  encodeControlMessage,
  type ControlRequest,
  type ControlResponse,
  type RequestOp,
} from "./protocol.js";

export type ConnectWithRetryOptions = {
  path: string;
  timeoutMs?: number;
  retryDelayMs?: number;
  /** Injected for tests. */
  connect?: (path: string) => net.Socket;
};

/**
 * Connect to the control pipe with retry/backoff (ADR 0003 cold-start).
 * Default: 25 ms delay, 5 s overall timeout.
 */
export function connectWithRetry(options: ConnectWithRetryOptions): Promise<net.Socket> {
  const timeoutMs = options.timeoutMs ?? 5000;
  const retryDelayMs = options.retryDelayMs ?? 25;
  const start = Date.now();

  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const socket = options.connect ? options.connect(options.path) : net.connect(options.path);

      const onConnect = () => {
        cleanup();
        resolve(socket);
      };
      const onError = (err: Error) => {
        cleanup();
        socket.destroy();
        if (Date.now() - start >= timeoutMs) {
          reject(err);
          return;
        }
        setTimeout(tryOnce, retryDelayMs);
      };
      const cleanup = () => {
        socket.off("connect", onConnect);
        socket.off("error", onError);
      };
      socket.once("connect", onConnect);
      socket.once("error", onError);
    };
    tryOnce();
  });
}

export type ControlPipeClientOptions = {
  path: string;
  connectWithRetry?: typeof connectWithRetry;
};

/**
 * Thin duplex client shared by hook adapter and CLI (PC-103).
 * Connect-before-send is enforced: every send opens (or reuses) a live socket
 * obtained via {@link connectWithRetry}.
 */
export class ControlPipeClient {
  private readonly path: string;
  private readonly connectFn: typeof connectWithRetry;
  private socket: net.Socket | null = null;
  private buffer = "";
  private readonly pending = new Map<
    string,
    { resolve: (r: ControlResponse) => void; reject: (e: Error) => void }
  >();

  constructor(options: ControlPipeClientOptions) {
    this.path = options.path;
    this.connectFn = options.connectWithRetry ?? connectWithRetry;
  }

  async ensureConnected(): Promise<net.Socket> {
    if (this.socket && !this.socket.destroyed) return this.socket;
    const socket = await this.connectFn({ path: this.path });
    this.attach(socket);
    return socket;
  }

  /** Fire-and-forget: write and do not wait for a reply. */
  async send(message: ControlRequest): Promise<void> {
    const socket = await this.ensureConnected();
    socket.write(encodeControlMessage(message));
  }

  /** Request/response: wait for a matching `id` reply. */
  async request(
    message: Extract<ControlRequest, { op: RequestOp }>,
    timeoutMs = 5000,
  ): Promise<ControlResponse> {
    const id = message.id || randomUUID();
    const withId = { ...message, id } as typeof message;
    const socket = await this.ensureConnected();

    return new Promise<ControlResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`control-pipe request timed out (${id})`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (r) => {
          clearTimeout(timer);
          resolve(r);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });

      socket.write(encodeControlMessage(withId));
    });
  }

  close(): void {
    for (const [, p] of this.pending) {
      p.reject(new Error("client closed"));
    }
    this.pending.clear();
    this.socket?.destroy();
    this.socket = null;
  }

  private attach(socket: net.Socket): void {
    this.socket = socket;
    this.buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      this.buffer += chunk;
      let nl: number;
      while ((nl = this.buffer.indexOf("\n")) !== -1) {
        const line = this.buffer.slice(0, nl);
        this.buffer = this.buffer.slice(nl + 1);
        this.dispatchReply(line);
      }
    });
    socket.on("close", () => {
      this.socket = null;
      for (const [, p] of this.pending) {
        p.reject(new Error("socket closed"));
      }
      this.pending.clear();
    });
    socket.on("error", () => {
      // Errors surface via connect/request promises; keep fail-open.
    });
  }

  private dispatchReply(line: string): void {
    let raw: unknown;
    try {
      raw = JSON.parse(line) as unknown;
    } catch {
      return;
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return;
    const obj = raw as Record<string, unknown>;
    if (obj.v !== PROTOCOL_VERSION || typeof obj.ok !== "boolean") return;
    const id = typeof obj.id === "string" ? obj.id : undefined;
    if (!id) return;
    const waiter = this.pending.get(id);
    if (!waiter) return;
    this.pending.delete(id);
    waiter.resolve({
      v: PROTOCOL_VERSION,
      id,
      ok: obj.ok,
      ...(typeof obj.error === "string" ? { error: obj.error } : {}),
      ...("result" in obj ? { result: obj.result } : {}),
    });
  }
}
