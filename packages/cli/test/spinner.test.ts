import { describe, expect, it, vi } from "vitest";

import { catFrame, spinnerEnabled, startCatSpinner } from "../src/cli/spinner.js";

function fakeStream(isTTY: boolean): { stream: NodeJS.WriteStream; chunks: string[] } {
  const chunks: string[] = [];
  const stream = {
    isTTY,
    write: (chunk: string) => {
      chunks.push(chunk);
      return true;
    },
  } as unknown as NodeJS.WriteStream;
  return { stream, chunks };
}

describe("cat spinner", () => {
  it("is disabled on non-TTY streams, in CI, and under NO_COLOR", () => {
    expect(spinnerEnabled({}, fakeStream(false).stream)).toBe(false);
    expect(spinnerEnabled({ CI: "true" }, fakeStream(true).stream)).toBe(false);
    expect(spinnerEnabled({ NO_COLOR: "1" }, fakeStream(true).stream)).toBe(false);
    expect(spinnerEnabled({}, fakeStream(true).stream)).toBe(true);
  });

  it("writes nothing at all when disabled", () => {
    const { stream, chunks } = fakeStream(false);
    const spinner = startCatSpinner("Copying…", { stream, env: {} });
    spinner.stop();
    expect(chunks).toEqual([]);
  });

  it("walks the cat toward the yarn and wraps around", () => {
    expect(catFrame(0, "x")).toBe("🐈       🧶 x");
    expect(catFrame(3, "x")).toBe("   🐈    🧶 x");
    expect(catFrame(7, "x")).toBe("       🐈🧶 x");
    expect(catFrame(8, "x")).toBe(catFrame(0, "x"));
  });

  it("animates frames on a timer and clears the line on stop", () => {
    vi.useFakeTimers();
    try {
      const { stream, chunks } = fakeStream(true);
      const spinner = startCatSpinner("Installing sounds…", { stream, env: {}, enabled: true });
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toContain("🐈");
      expect(chunks[0]).toContain("Installing sounds…");

      vi.advanceTimersByTime(120 * 3);
      expect(chunks).toHaveLength(4);
      expect(chunks[1]).not.toBe(chunks[2]);

      spinner.stop();
      expect(chunks.at(-1)).toBe("\r\u001b[2K");
      spinner.stop(); // idempotent
      const after = chunks.length;
      vi.advanceTimersByTime(1000);
      expect(chunks).toHaveLength(after);
    } finally {
      vi.useRealTimers();
    }
  });
});
