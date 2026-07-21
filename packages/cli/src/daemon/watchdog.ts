import {
  classifyProcess,
  type ClassifyOptions,
  type ProcessIdentity,
  type ProcessLiveness,
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
  /**
   * Platforms that require a starttime token for identity (everything
   * except win32). Sessions missing starttime are skipped there.
   */
  platform?: NodeJS.Platform;
};

/**
 * One watchdog pass over the registry (PC-202 / RR-04.1).
 * Pure registry mutation — caller drives playback from `playbackCount()`.
 *
 * - **dead** → remove session
 * - **suspended** → mark paused (keep entry)
 * - **running** → clear paused
 */
export function applyWatchdogTick(
  registry: SessionRegistry,
  options: ApplyWatchdogOptions = {},
): WatchdogTickResult {
  const classify = options.classify ?? classifyProcess;
  const platform = options.platform ?? process.platform;
  const classifyOptions: ClassifyOptions = {
    platform,
    ...options.classifyOptions,
  };

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

function classifySession(
  session: SessionRecord,
  classify: WatchdogClassify,
  classifyOptions: ClassifyOptions,
  platform: NodeJS.Platform,
): ProcessLiveness | "skip" {
  if (session.claudePid === undefined) return "skip";

  if (platform !== "win32") {
    if (session.starttime === undefined || session.starttime === "") {
      // Cannot apply the required (pid, starttime) identity check.
      return "skip";
    }
    return classify({ pid: session.claudePid, starttime: session.starttime }, classifyOptions);
  }

  // Windows: existence-only; starttime unused.
  return classify({ pid: session.claudePid, starttime: session.starttime ?? "" }, classifyOptions);
}
