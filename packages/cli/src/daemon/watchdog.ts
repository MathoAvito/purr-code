import {
  classifyProcess,
  primaryStateLetter,
  readProcessSnapshots,
  type ClassifyOptions,
  type ProcessIdentity,
  type ProcessLiveness,
  type ProcessSnapshot,
} from "../process/liveness.js";
import type { SessionRecord, SessionRegistry } from "../session/SessionRegistry.js";

export type WatchdogClassify = (
  identity: ProcessIdentity,
  options?: ClassifyOptions,
) => ProcessLiveness;

export type WatchdogTickResult = {
  /** True if any session was removed or pause-flag flipped. */
  changed: boolean;
  removed: string[];
  paused: string[];
  resumed: string[];
};

export type ApplyWatchdogOptions = {
  classify?: WatchdogClassify;
  classifyOptions?: ClassifyOptions;
  /** Override platform detection (tests). */
  platform?: NodeJS.Platform;
};

/**
 * One watchdog pass over the registry (PC-202 / RR-04.1).
 * Pure registry mutation — caller drives playback from `playbackCount()`.
 *
 * Prefetches process snapshots asynchronously (batched `ps` on macOS,
 * concurrent `/proc` on Linux) so classification never blocks the event loop
 * with sync subprocess I/O.
 *
 * - **dead** → remove session
 * - **suspended** → mark paused (keep entry)
 * - **running** → clear paused
 */
export async function applyWatchdogTick(
  registry: SessionRegistry,
  options: ApplyWatchdogOptions = {},
): Promise<WatchdogTickResult> {
  const classify = options.classify ?? classifyProcess;
  const platform = options.platform ?? process.platform;
  const classifyOptions = await buildClassifyOptions(registry, {
    classify,
    platform,
    classifyOptions: options.classifyOptions,
  });

  const removed: string[] = [];
  const paused: string[] = [];
  const resumed: string[] = [];

  // Snapshot the list — mutations during iteration are safe via stop/setPaused.
  for (const session of registry.list()) {
    const decision = classifySession(session, classify, classifyOptions, platform);
    if (decision === "skip") continue;

    if (decision === "dead") {
      registry.stop(session.sessionId);
      removed.push(session.sessionId);
      continue;
    }

    if (decision === "suspended") {
      if (registry.setPaused(session.sessionId, true)) {
        paused.push(session.sessionId);
      }
      continue;
    }

    // running
    if (registry.setPaused(session.sessionId, false)) {
      resumed.push(session.sessionId);
    }
  }

  return {
    changed: removed.length + paused.length + resumed.length > 0,
    removed,
    paused,
    resumed,
  };
}

/**
 * Build classify options with a prefetched snapshot map when using the real
 * classifier (no custom `readSnapshot` / no custom `classify`).
 */
async function buildClassifyOptions(
  registry: SessionRegistry,
  args: {
    classify: WatchdogClassify;
    platform: NodeJS.Platform;
    classifyOptions?: ClassifyOptions | undefined;
  },
): Promise<ClassifyOptions> {
  const base: ClassifyOptions = {
    platform: args.platform,
    ...args.classifyOptions,
  };

  // Injected classifiers / snapshot readers own their I/O — don't prefetch.
  if (args.classify !== classifyProcess || base.readSnapshot) {
    return base;
  }

  const pids: number[] = [];
  for (const session of registry.list()) {
    if (session.claudePid !== undefined) pids.push(session.claudePid);
  }

  const snapshots = await readProcessSnapshots(pids, args.platform);
  return {
    ...base,
    readSnapshot: (pid: number): ProcessSnapshot | null => snapshots.get(pid) ?? null,
  };
}

function classifySession(
  session: SessionRecord,
  classify: WatchdogClassify,
  classifyOptions: ClassifyOptions,
  platform: NodeJS.Platform,
): ProcessLiveness | "skip" {
  if (session.claudePid === undefined) return "skip";

  if (platform !== "win32") {
    if (session.starttime === undefined || session.starttime === "") {
      // Legacy / incomplete registration: no identity token — classify from
      // live state without the PID-reuse guard (PC-106 boot compatibility).
      return classifyWithoutStarttime(session.claudePid, classify, classifyOptions, platform);
    }
    return classify({ pid: session.claudePid, starttime: session.starttime }, classifyOptions);
  }

  // Windows: existence-only; starttime unused.
  return classify({ pid: session.claudePid, starttime: session.starttime ?? "" }, classifyOptions);
}

/**
 * Degraded path when `starttime` is missing: still detect dead/zombie/suspend,
 * but cannot catch PID reuse.
 */
function classifyWithoutStarttime(
  pid: number,
  classify: WatchdogClassify,
  classifyOptions: ClassifyOptions,
  platform: NodeJS.Platform,
): ProcessLiveness {
  // Custom classifiers (tests) typically key on pid alone.
  if (classify !== classifyProcess) {
    return classify({ pid, starttime: "" }, classifyOptions);
  }
  const snap =
    classifyOptions.readSnapshot?.(pid) ??
    // Should be prefetched; fall through to null = dead if missing.
    null;
  void platform;
  if (snap === null) return "dead";
  const letter = primaryStateLetter(snap.state);
  if (letter === "Z" || letter === "X") return "dead";
  if (letter === "T") return "suspended";
  return "running";
}
