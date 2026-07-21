import { writePidfile, removePidfile } from "./pidfile.js";
import { reconcileRegistry, type ReconcileResult } from "./reconcile.js";
import type { WatchdogClassify } from "./watchdog.js";
import {
  ControlPipeServer,
  type ControlMessageHandler,
  type ListenResult,
} from "../control/server.js";
import { resolveControlPipePath } from "../control/paths.js";
import type { ControlRequest } from "../control/protocol.js";
import { SessionRegistry } from "../session/SessionRegistry.js";
import { PlaybackController } from "../session/PlaybackController.js";
import { loadRegistrySnapshot, writeRegistrySnapshot } from "../session/snapshot.js";
import type { AudioBackend } from "../audio/types.js";
import type { ClassifyOptions } from "../process/liveness.js";
import {
  applyConfigPatch,
  loadConfig,
  type PurrCodeConfig,
  type ResolveConfigDirOptions,
} from "../config/index.js";

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
  /**
   * Stale-session TTL in ms (PC-203 / RR-04.2). Default from config
   * (`staleSessionMinutes` × 60s) or 10 minutes. Set `0` to disable TTL GC.
   */
  staleSessionMs?: number | undefined;
  /** Config directory resolution overrides (PC-204 tests). */
  configDir?: ResolveConfigDirOptions | undefined;
  /** Inject initial config (tests); skips disk load when set. */
  config?: PurrCodeConfig | undefined;
};

/**
 * Per-user player daemon (PC-104 + PC-105 + PC-202 + PC-203).
 * Bind-as-mutex listen, pidfile, connection-pinned idle-exit, session registry,
 * refcount playback, state-aware PID watchdog, and event/TTL reconciliation.
 */
export class Daemon {
  private readonly idleMs: number;
  private readonly now: () => number;
  private readonly onIdleExit: (() => void) | undefined;
  private readonly userOnMessage: ControlMessageHandler | undefined;
  private readonly registry: SessionRegistry;
  private readonly playback: PlaybackController | null;
  private readonly watchdogIntervalMs: number;
  private staleSessionMs: number;
  private config: PurrCodeConfig;
  private readonly configDirOptions: ResolveConfigDirOptions;
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
    this.configDirOptions = {
      ...(options.platform !== undefined ? { platform: options.platform } : {}),
      ...(options.env !== undefined ? { env: options.env } : {}),
      ...options.configDir,
    };
    this.config =
      options.config ??
      loadConfig({ ...this.configDirOptions, writeDefaultsIfMissing: false }).config;
    this.registry = options.registry ?? new SessionRegistry({ now: this.now });
    this.playback =
      options.playback ??
      (options.audioBackend
        ? new PlaybackController({
            backend: options.audioBackend,
            volume: this.config.volume,
            fadeInMs: this.config.fadeInMs,
            fadeOutMs: this.config.fadeOutMs,
            soundPath: `fake://${this.config.sound}`,
          })
        : null);
    this.watchdogIntervalMs =
      options.watchdogIntervalMs === undefined
        ? DEFAULT_WATCHDOG_INTERVAL_MS
        : options.watchdogIntervalMs;
    this.staleSessionMs =
      options.staleSessionMs === undefined
        ? this.config.staleSessionMinutes * 60_000
        : options.staleSessionMs;
    this.watchdogClassify = options.watchdogClassify;
    this.watchdogClassifyOptions = options.watchdogClassifyOptions;
  }

  getConfig(): PurrCodeConfig {
    return this.config;
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
    // Load raw snapshot, then full liveness+TTL reconcile before playback (PC-203).
    this.registry.replaceAll(loaded.snapshot.sessions);
    this.reconcileInPlace();
    if (this.effectivePlaybackCount() > 0 && this.playback) {
      await this.syncPlayback();
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
    const result = this.reconcileInPlace();
    if (!result.changed) return;
    await this.syncPlayback();
    this.scheduleSnapshot();
    this.armIdleTimer();
  }

  private effectivePlaybackCount(): number {
    if (!this.config.enabled) return 0;
    return this.registry.playbackCount();
  }

  private async syncPlayback(): Promise<void> {
    await this.playback?.onActiveCount(this.effectivePlaybackCount());
  }

  /** Liveness + stale TTL over the full registry (PC-203). */
  private reconcileInPlace(): ReconcileResult {
    return reconcileRegistry(this.registry, {
      now: this.now,
      staleSessionMs: this.staleSessionMs,
      platform: this.bootOptions.platform ?? process.platform,
      ...(this.watchdogClassify !== undefined ? { classify: this.watchdogClassify } : {}),
      ...(this.watchdogClassifyOptions !== undefined
        ? { classifyOptions: this.watchdogClassifyOptions }
        : {}),
    });
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

      if (message.op === "set-config") {
        const { config } = applyConfigPatch(this.config, message.config, this.configDirOptions);
        this.config = config;
        this.staleSessionMs = config.staleSessionMinutes * 60_000;
        this.playback?.applySettings({
          volume: config.volume,
          fadeInMs: config.fadeInMs,
          fadeOutMs: config.fadeOutMs,
          soundPath: `fake://${config.sound}`,
        });
      } else if (message.op === "start") {
        this.registry.start({
          sessionId: message.sessionId,
          ...(message.claudePid !== undefined ? { claudePid: message.claudePid } : {}),
          ...(message.starttime !== undefined ? { starttime: message.starttime } : {}),
        });
      } else if (
        message.op === "stop" ||
        message.op === "failure" ||
        message.op === "session-end"
      ) {
        this.registry.touch(message.sessionId);
        this.registry.stop(message.sessionId);
      }

      // PC-203: every incoming message reconciles *all* sessions (liveness + TTL).
      const reconciled = this.reconcileInPlace();
      await this.syncPlayback();
      if (
        reconciled.changed ||
        message.op === "start" ||
        message.op === "stop" ||
        message.op === "failure" ||
        message.op === "session-end" ||
        message.op === "set-config"
      ) {
        this.scheduleSnapshot();
      }
      this.armIdleTimer();

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
            enabled: this.config.enabled,
          },
        };
      }

      if (message.op === "set-config") {
        return { ok: true, result: { config: this.config } };
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
