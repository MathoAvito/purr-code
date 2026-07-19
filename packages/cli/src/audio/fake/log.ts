import { readFile } from "node:fs/promises";

import type { FakeAudioEvent, FakeAudioEventType } from "./events.js";

/** Parse a fake-audio JSONL log into events (skips blank lines). */
export async function readFakeAudioLog(logPath: string): Promise<FakeAudioEvent[]> {
  let raw: string;
  try {
    raw = await readFile(logPath, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return [];
    }
    throw err;
  }

  const events: FakeAudioEvent[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim() === "") {
      continue;
    }
    events.push(JSON.parse(line) as FakeAudioEvent);
  }
  return events;
}

/** Return the first index where `expected` appears as a contiguous subsequence, or -1. */
export function findEventSequence(
  events: readonly FakeAudioEvent[],
  expected: readonly FakeAudioEventType[],
): number {
  if (expected.length === 0) {
    return 0;
  }
  for (let i = 0; i <= events.length - expected.length; i++) {
    let match = true;
    for (let j = 0; j < expected.length; j++) {
      if (events[i + j]?.type !== expected[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      return i;
    }
  }
  return -1;
}

/**
 * Assert that `expected` appears as a contiguous subsequence of event types.
 * Throws a descriptive Error on failure (Vitest-agnostic for reuse in e2e).
 */
export function assertContainsSequence(
  events: readonly FakeAudioEvent[],
  expected: readonly FakeAudioEventType[],
): void {
  if (findEventSequence(events, expected) >= 0) {
    return;
  }
  const actual = events.map((e) => e.type).join(" → ") || "(empty)";
  const want = expected.join(" → ");
  throw new Error(`Expected event sequence [${want}] not found in [${actual}]`);
}

/** Assert the log's event types equal `expected` exactly (order and length). */
export function assertExactSequence(
  events: readonly FakeAudioEvent[],
  expected: readonly FakeAudioEventType[],
): void {
  const actual = events.map((e) => e.type);
  const same = actual.length === expected.length && actual.every((t, i) => t === expected[i]);
  if (!same) {
    throw new Error(
      `Expected exact sequence [${expected.join(" → ")}] but got [${actual.join(" → ") || "(empty)"}]`,
    );
  }
}
