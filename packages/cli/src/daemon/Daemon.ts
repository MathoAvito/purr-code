import { writePidfile, removePidfile } from "./pidfile.js";
import { applyWatchdogTick, type WatchdogClassify } from "./watchdog.js";
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
import type { ClassifyOptions } from "../process/liveness.js";

/** Default watchdog cadence — proven ≤5 s fade bound in ADR 0006. */
export const DEFAULT_WATCHDOG_INTERVAL_MS = 2000;

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
  /**
   * Windows named-pipe suffix override (tests / isolation).
   * Production omits this so the per-user SID names the pipe.
   */
  windowsPipeSuffix?: string | undefined;
  /**
   * Watchdog poll interval in ms (PC-202). Default 2000; set `0` to disable.
   * Allowed range for production cadence is 2–5 s; tests may use shorter.
   */
  watchdogIntervalMs?: number | undefined;
  /** Inject classifier (tests). */
  watchdogClassify?: WatchdogClassify | undefined;
  /** Extra classify options (tests). */
  watchdogClassifyOptions?: ClassifyOptions | undefined;
};

/**
 * Per-user player daemon (PC-104 + PC-105 + PC-202).
 * Bind-as-mutex listen, pidfile, connection-pinned idle-exit, session registry,
 * refcount playback, and state-aware PID watchdog.
 */
export class Daemon {
  private readonly idleMs: number;
  private readonly now: () => number;
  private readonly onIdleExit: (() => void) | undefined;
  private readonly userOnMessage: ControlMessageHandler | undefined;
  private readonly registry: SessionRegistry;
  private readonly playback: PlaybackController | null;
  private readonly watchdogIntervalMs: number;
  private readonly watchdogClassify: WatchdogClassify | undefined;
  private readonly watchdogClassifyOptions: ClassifyOptions | undefined;
  private bootAt = 0;
  private lastActivityAt = 0;
  private connections = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private server: ControlPipeServer | null = null;
  private runtimeDir = "";
  private pipePath = "";
  private kind: "uds" | "named-pipe" = "uds";
  private shuttingDown = false;
  private snapshotTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly bootOptions: DaemonOptions;
  /** Resolves when snapshot restore (+ playback) has finished; handlers await this. */
  private bootReady: Promise<void> = Promise.resolve();
  /**
   * Serializes registry + playback mutations so the watchdog never races the
   * control-pipe handler (and ticks never block the pipe accept loop).
   */
  private mutationChain: Promise<void> = Promise.resolve();

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
    this.watchdogIntervalMs =
      options.watchdogIntervalMs === undefined
        ? DEFAULT_WATCHDOG_INTERVAL_MS
        : options.watchdogIntervalMs;
    this.watchdogClassify = options.watchdogClassify;
    this.watchdogClassifyOptions = options.watchdogClassifyOptions;
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
      ...(this.bootOptions.windowsPipeSuffix !== undefined
        ? { windowsPipeSuffix: this.bootOptions.windowsPipeSuffix }
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
    this.startWatchdog();
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
      await this.playback.onActiveCount(this.registry.playbackCount());
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

  private startWatchdog(): void {
    if (this.watchdogIntervalMs <= 0) return;
    if (this.watchdogTimer) return;
    // Schedule on the event loop; the tick itself is enqueued so it never
    // stalls the control-pipe accept/read path (PC-202).
    this.watchdogTimer = setInterval(() => {
      void this.enqueueMutation(() => this.runWatchdogTick());
    }, this.watchdogIntervalMs);
    // Unref so the timer alone cannot keep the process alive after idle-exit.
    this.watchdogTimer.unref?.();
  }

  private stopWatchdog(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  /** Exposed for tests — run one watchdog pass under the mutation lock. */
  async runWatchdogOnce(): Promise<void> {
    await this.enqueueMutation(() => this.runWatchdogTick());
  }

  private async runWatchdogTick(): Promise<void> {
    if (this.shuttingDown) return;
    const result = applyWatchdogTick(this.registry, {
      platform: this.bootOptions.platform ?? process.platform,
      ...(this.watchdogClassify !== undefined ? { classify: this.watchdogClassify } : {}),
      ...(this.watchdogClassifyOptions !== undefined
        ? { classifyOptions: this.watchdogClassifyOptions }
        : {}),
    });
    if (!result.changed) return;
    await this.playback?.onActiveCount(this.registry.playbackCount());
    this.scheduleSnapshot();
    this.armIdleTimer();
  }

  private enqueueMutation<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.mutationChain.then(fn, fn);
    this.mutationChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async shutdown(reason = "shutdown"): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    void reason;
    this.stopWatchdog();
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
    return this.enqueueMutation(async () => {
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
            playbackSessions: this.registry.playbackCount(),
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
      } else if (
        message.op === "stop" ||
        message.op === "failure" ||
        message.op === "session-end"
      ) {
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
    });
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
