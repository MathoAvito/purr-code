/**
 * PurrCode — hook adapter, CLI, and per-user player daemon.
 *
 * Subsystems land story by story (see docs/planning/): hook adapter (PC-107),
 * daemon core (PC-104), session registry (PC-105), audio backends (PC-101,
 * PC-301+). This entry point only carries what already exists.
 */

/** Hook events PurrCode reacts to, verified against Claude Code in ADR 0001. */
export const HOOK_EVENTS = ["UserPromptSubmit", "Stop", "StopFailure", "SessionEnd"] as const;

export type HookEvent = (typeof HOOK_EVENTS)[number];

export function isHookEvent(value: string): value is HookEvent {
  return (HOOK_EVENTS as readonly string[]).includes(value);
}
