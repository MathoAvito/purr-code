import { describe, expect, it } from "vitest";
import { HOOK_EVENTS, isHookEvent } from "../src/index.js";

describe("isHookEvent", () => {
  it("accepts every registered hook event", () => {
    for (const event of HOOK_EVENTS) {
      expect(isHookEvent(event)).toBe(true);
    }
  });

  it("rejects events PurrCode does not subscribe to", () => {
    expect(isHookEvent("Notification")).toBe(false);
    expect(isHookEvent("PreCompact")).toBe(false);
    expect(isHookEvent("")).toBe(false);
  });
});
