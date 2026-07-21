import { writePidfile, removePidfile } from "./pidfile.js";
import {
  ControlPipeServer,
  type ControlMessageHandler,
  type ListenResult,
} from "../control/server.js";
import { resolveControlPipePath } from "../control/paths.js";
import type { ControlRequest } from "../control/protocol.js";

export type DaemonOptions = {
  runtimeDir?: string | undefined;
  platform?: NodeJS.Platform | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  /** Idle grace period with zero sessions + zero connections (default 1500 ms). */
  idleMs?: number | undefined;
  /** Optional message handler overlay (session registry hooks in later). */
  onMessage?: ControlMessageHandler | undefined;
  /** Clock for tests. */
  now?: (() => number) | undefined;
  onIdleExit?: (() => void) | undefined;
};

/**
 * Per-user player daemon core (PC-104).
 * Bind-as-mutex listen, pidfile, connection-pinned idle-exit, clean shutdown.
 */
export class Daemon {
  private readonly idleMs: number;
  private readonly now: () => number;
  private readonly onIdleExit: (() => void) | undefined;
  private readonly userOnMessage: ControlMessageHandler | undefined;
  private bootAt = 0;
  private lastActivityAt = 0;
  private connections = 0;
  /** Active session count — PC-105 owns the registry; this is the idle signal. */
  private activeSessions = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private server: ControlPipeServer | null = null;
  private runtimeDir = "";
  private pipePath = "";
  private kind: "uds" | "named-pipe" = "uds";
  private shuttingDown = false;

  constructor(options: DaemonOptions = {}) {
    this.idleMs = options.idleMs ?? 1500;
    this.now = options.now ?? Date.now;
    this.onIdleExit = options.onIdleExit;
    this.userOnMessage = options.onMessage;
    this.bootOptions = options;
  }

  private readonly bootOptions: DaemonOptions;

  get connectionCount(): number {
    return this.connections;
  }

  get sessionCount(): number {
    return this.activeSessions;
  }

  get controlPath(): string {
    return this.pipePath;
  }

  getRuntimeDir(): string {
    return this.runtimeDir;
  }

  /** Test/helper: set active session count used by idle-exit. */
  setActiveSessionCount(count: number): void {
    this.activeSessions = Math.max(0, count);
    this.touchActivity();
    this.armIdleTimer();
  }

  async start(): Promise<ListenResult> {
    const resolved = await resolveControlPipePath({
      ...(this.bootOptions.platform !== undefined ? { platform: this.bootOptions.platform } : {}),
      ...(this.bootOptions.env !== undefined ? { env: this.bootOptions.env } : {}),
      ...(this.bootOptions.runtimeDir !== undefined
        ? { runtimeDir: this.bootOptions.runtimeDir }
        : {}),
    });
    this.runtimeDir = resolved.runtimeDir;
    this.pipePath = resolved.path;
    this.kind = resolved.kind;

    this.bootAt = this.now();
    this.lastActivityAt = this.bootAt;

    this.server = new ControlPipeServer({
      path: this.pipePath,
      kind: this.kind,
      onConnectionCount: (n) => {
        this.connections = n;
        this.armIdleTimer();
      },
      onMessage: (msg) => this.handleMessage(msg),
    });

    const result = await this.server.listen();
    if (result.status === "lost-race") {
      this.server = null;
      return result;
    }

    writePidfile(this.runtimeDir, process.pid);
    this.armIdleTimer();
    return result;
  }

  async shutdown(reason = "shutdown"): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    void reason;
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    // Fade/snapshot arrive in PC-105/106 — tear down transport + pidfile now.
    await this.server?.close();
    this.server = null;
    removePidfile(this.runtimeDir);
  }

  private async handleMessage(message: ControlRequest) {
    this.touchActivity();

    if (message.op === "shutdown") {
      // Reply first; tear down on next tick so the response can flush.
      setTimeout(() => {
        void this.shutdown("message");
      }, 0);
      return { ok: true, result: { shuttingDown: true } };
    }

    if (message.op === "status") {
      return {
        ok: true,
        result: {
          pid: process.pid,
          bootAt: this.bootAt,
          lastActivityAt: this.lastActivityAt,
          connections: this.connections,
          sessions: this.activeSessions,
        },
      };
    }

    // Minimal session accounting until PC-105 registry lands.
    if (message.op === "start") {
      this.activeSessions += 1;
      this.armIdleTimer();
    } else if (message.op === "stop" || message.op === "failure" || message.op === "session-end") {
      this.activeSessions = Math.max(0, this.activeSessions - 1);
      this.armIdleTimer();
    }

    if (this.userOnMessage) {
      return this.userOnMessage(message);
    }
    return { ok: true };
  }

  private touchActivity(): void {
    this.lastActivityAt = this.now();
  }

  /**
   * Idle-exit never evaluates while any client connection is open.
   * Requires zero sessions + zero connections + grace since last activity/boot.
   */
  private armIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.shuttingDown) return;
    if (this.connections > 0) return;
    if (this.activeSessions > 0) return;

    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.connections > 0 || this.activeSessions > 0 || this.shuttingDown) return;
      const idleFor = this.now() - this.lastActivityAt;
      if (idleFor < this.idleMs) {
        this.armIdleTimer();
        return;
      }
      void this.shutdown("idle").then(() => this.onIdleExit?.());
    }, this.idleMs);
  }
}
