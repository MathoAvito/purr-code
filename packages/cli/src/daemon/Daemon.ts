import { writePidfile, removePidfile } from "./pidfile.js";
import {
  ControlPipeServer,
  type ControlMessageHandler,
  type ListenResult,
} from "../control/server.js";
import { resolveControlPipePath } from "../control/paths.js";
import type { ControlRequest } from "../control/protocol.js";
import { SessionRegistry } from "../session/SessionRegistry.js";
import { PlaybackController } from "../session/PlaybackController.js";
import {
  filterLiveSessions,
  loadRegistrySnapshot,
  writeRegistrySnapshot,
} from "../session/snapshot.js";
import type { AudioBackend } from "../audio/types.js";

export type DaemonOptions = {
  runtimeDir?: string | undefined;
  platform?: NodeJS.Platform | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  /** Idle grace period with zero sessions + zero connections (default 1500 ms). */
  idleMs?: number | undefined;
  /** Optional message handler overlay. */
  onMessage?: ControlMessageHandler | undefined;
  /** Clock for tests. */
  now?: (() => number) | undefined;
  onIdleExit?: (() => void) | undefined;
  /** When set, drives fade/play from session refcount (PC-105). */
  audioBackend?: AudioBackend | undefined;
  registry?: SessionRegistry | undefined;
  playback?: PlaybackController | undefined;
};

/**
 * Per-user player daemon (PC-104 + PC-105).
 * Bind-as-mutex listen, pidfile, connection-pinned idle-exit, session registry,
 * and refcount playback state machine.
 */
export class Daemon {
  private readonly idleMs: number;
  private readonly now: () => number;
  private readonly onIdleExit: (() => void) | undefined;
  private readonly userOnMessage: ControlMessageHandler | undefined;
  private readonly registry: SessionRegistry;
  private readonly playback: PlaybackController | null;
  private bootAt = 0;
  private lastActivityAt = 0;
  private connections = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private server: ControlPipeServer | null = null;
  private runtimeDir = "";
  private pipePath = "";
  private kind: "uds" | "named-pipe" = "uds";
  private shuttingDown = false;
  private snapshotTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly bootOptions: DaemonOptions;
  /** Resolves when snapshot restore (+ playback) has finished; handlers await this. */
  private bootReady: Promise<void> = Promise.resolve();

  constructor(options: DaemonOptions = {}) {
    this.idleMs = options.idleMs ?? 1500;
    this.now = options.now ?? Date.now;
    this.onIdleExit = options.onIdleExit;
    this.userOnMessage = options.onMessage;
    this.bootOptions = options;
    this.registry = options.registry ?? new SessionRegistry({ now: this.now });
    this.playback =
      options.playback ??
      (options.audioBackend
        ? new PlaybackController({ backend: options.audioBackend, fadeOutMs: 50, fadeInMs: 0 })
        : null);
  }

  get connectionCount(): number {
    return this.connections;
  }

  get sessionCount(): number {
    return this.registry.size;
  }

  getSessionRegistry(): SessionRegistry {
    return this.registry;
  }

  get controlPath(): string {
    return this.pipePath;
  }

  getRuntimeDir(): string {
    return this.runtimeDir;
  }

  /** Test/helper: clear/replace active sessions used by idle-exit. */
  setActiveSessionCount(count: number): void {
    this.registry.clear();
    for (let i = 0; i < count; i++) {
      this.registry.start({ sessionId: `__test-${i}` });
    }
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
    this.bootReady = this.restoreSnapshot();
    await this.bootReady;
    this.armIdleTimer();
    return result;
  }

  private async restoreSnapshot(): Promise<void> {
    const loaded = loadRegistrySnapshot(this.runtimeDir);
    if (!loaded.ok) {
      // missing or corrupt → empty registry (safe regeneration)
      return;
    }
    const live = filterLiveSessions(loaded.snapshot.sessions);
    this.registry.replaceAll(live);
    if (live.length > 0 && this.playback) {
      await this.playback.onActiveCount(live.length);
    }
  }

  private scheduleSnapshot(): void {
    if (this.snapshotTimer) clearTimeout(this.snapshotTimer);
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = null;
      try {
        writeRegistrySnapshot(this.runtimeDir, this.registry.list());
      } catch {
        // never crash the daemon on snapshot failure
      }
    }, 50);
  }

  async shutdown(reason = "shutdown"): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    void reason;
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.snapshotTimer) {
      clearTimeout(this.snapshotTimer);
      this.snapshotTimer = null;
    }
    // Persist sessions *before* clearing so a restart can recover (PC-106).
    // Idle-exit already has an empty registry, so this writes [].
    try {
      writeRegistrySnapshot(this.runtimeDir, this.registry.list());
    } catch {
      // ignore
    }
    if (this.playback) {
      if (this.registry.size > 0) {
        this.registry.clear();
      }
      // Always drive count→0 so an in-flight fade is awaited/cancelled cleanly.
      await this.playback.onActiveCount(0);
    } else {
      this.registry.clear();
    }
    await this.server?.close();
    this.server = null;
    removePidfile(this.runtimeDir);
  }

  private async handleMessage(message: ControlRequest) {
    await this.bootReady;
    this.touchActivity();

    if (message.op === "shutdown") {
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
          sessions: this.registry.size,
          phase: this.playback?.getPhase() ?? "idle",
        },
      };
    }

    if (message.op === "start") {
      const { activeCount } = this.registry.start({
        sessionId: message.sessionId,
        ...(message.claudePid !== undefined ? { claudePid: message.claudePid } : {}),
        ...(message.starttime !== undefined ? { starttime: message.starttime } : {}),
      });
      await this.playback?.onActiveCount(activeCount);
      this.scheduleSnapshot();
      this.armIdleTimer();
    } else if (message.op === "stop" || message.op === "failure" || message.op === "session-end") {
      this.registry.touch(message.sessionId);
      const { activeCount } = this.registry.stop(message.sessionId);
      await this.playback?.onActiveCount(activeCount);
      this.scheduleSnapshot();
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

  private armIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.shuttingDown) return;
    if (this.connections > 0) return;
    if (this.registry.size > 0) return;

    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.connections > 0 || this.registry.size > 0 || this.shuttingDown) return;
      const idleFor = this.now() - this.lastActivityAt;
      if (idleFor < this.idleMs) {
        this.armIdleTimer();
        return;
      }
      void this.shutdown("idle").then(() => this.onIdleExit?.());
    }, this.idleMs);
  }
}
