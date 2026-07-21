/**
 * Re-export for package consumers; prefer `node dist/hook.js` as the process entry.
 */
export { runHook, type RunHookOptions } from "./runHook.js";
export {
  parseHookStdin,
  readStarttimeToken,
  shouldSuppressHooks,
  type HookEventName,
  type HookPayload,
  type ParseHookResult,
} from "./parse.js";
