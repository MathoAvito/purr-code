import { mkdtemp, readFile, rm, writeFile, mkdir, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { resolveDataDirPath, resolveSoundsDirPath } from "../src/audio/dataDir.js";
import { resolveBundledSoundPath, isWavFile } from "../src/audio/wavCache.js";
import { resolveConfigDirPath, resolveConfigFilePath } from "../src/config/paths.js";
import {
  preparePluginData,
  validateHooksManifest,
  pluginDataFromEnv,
  pluginRootFromEnv,
  isPluginContext,
} from "../src/plugin/index.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const pluginHooksPath = join(
  repoRoot,
  "packages",
  "plugin",
  "marketplace",
  "plugins",
  "purrcode",
  "hooks",
  "hooks.json",
);

describe("plugin env + paths (PC-401)", () => {
  it("detects plugin context from CLAUDE_PLUGIN_*", () => {
    expect(isPluginContext({})).toBe(false);
    expect(pluginRootFromEnv({ CLAUDE_PLUGIN_ROOT: "/p/root" })).toBe("/p/root");
    expect(pluginDataFromEnv({ CLAUDE_PLUGIN_DATA: "/p/data" })).toBe("/p/data");
    expect(isPluginContext({ CLAUDE_PLUGIN_DATA: "/p/data" })).toBe(true);
  });

  it("routes config + data dirs to CLAUDE_PLUGIN_DATA", () => {
    const env = { CLAUDE_PLUGIN_DATA: "/tmp/plugin-data" };
    expect(resolveConfigDirPath({ env, platform: "linux" })).toBe("/tmp/plugin-data");
    expect(resolveConfigFilePath({ env, platform: "linux" })).toBe(
      join("/tmp/plugin-data", "config.json"),
    );
    expect(resolveDataDirPath({ env, platform: "linux" })).toBe("/tmp/plugin-data");
    expect(resolveSoundsDirPath({ env, platform: "linux" })).toBe(
      join("/tmp/plugin-data", "sounds"),
    );
  });

  it("falls back to XDG paths when plugin env unset", () => {
    const home = "/home/tester";
    expect(
      resolveConfigDirPath({
        platform: "linux",
        home,
        env: { XDG_CONFIG_HOME: join(home, ".config") },
      }),
    ).toBe(join(home, ".config", "purrcode"));
    expect(
      resolveDataDirPath({
        platform: "linux",
        home,
        env: { XDG_DATA_HOME: join(home, ".local", "share") },
      }),
    ).toBe(join(home, ".local", "share", "purrcode"));
  });

  it("resolveBundledSoundPath prefers CLAUDE_PLUGIN_ROOT", () => {
    const r = resolveBundledSoundPath("sleepy", {
      env: { CLAUDE_PLUGIN_ROOT: "/opt/purrcode-plugin" },
    });
    expect(r.root).toBe("/opt/purrcode-plugin");
    expect(r.ogg).toBe(join("/opt/purrcode-plugin", "sounds", "sleepy.ogg"));
    expect(r.preferred).toBe(r.ogg);
  });
});

describe("hooks.json manifest (PC-401 / §15)", () => {
  it("accepts the production plugin hooks.json", async () => {
    const raw: unknown = JSON.parse(await readFile(pluginHooksPath, "utf8"));
    expect(validateHooksManifest(raw)).toEqual([]);
  });

  it("wires PreToolUse/PostToolUse as heartbeat hooks (ADR 0008)", async () => {
    const raw = JSON.parse(await readFile(pluginHooksPath, "utf8")) as {
      hooks: Record<string, Array<{ hooks: Array<{ args: string[] }> }>>;
    };
    for (const event of ["PreToolUse", "PostToolUse"]) {
      const cmd = raw.hooks[event]?.[0]?.hooks?.[0];
      expect(cmd?.args?.[1]).toBe("heartbeat");
    }
  });

  it("rejects a manifest missing the heartbeat events", () => {
    const noHeartbeat = {
      description: "x",
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ type: "command", command: "node", args: ["h.js", "start"], async: true, timeout: 5 }] },
        ],
        Stop: [
          { hooks: [{ type: "command", command: "node", args: ["h.js", "stop"], async: true, timeout: 5 }] },
        ],
        StopFailure: [
          { hooks: [{ type: "command", command: "node", args: ["h.js", "failure"], async: true, timeout: 5 }] },
        ],
        SessionEnd: [
          { hooks: [{ type: "command", command: "node", args: ["h.js", "session-end"], async: true, timeout: 5 }] },
        ],
      },
    };
    const issues = validateHooksManifest(noHeartbeat, { hookScriptArg: "h.js" });
    expect(issues.some((i) => i.path === "hooks.PreToolUse")).toBe(true);
    expect(issues.some((i) => i.path === "hooks.PostToolUse")).toBe(true);
  });

  it("rejects string-form, matchers, missing events, and wrong args", () => {
    const bad = {
      description: "x",
      hooks: {
        UserPromptSubmit: [
          {
            matcher: ".*",
            hooks: [
              {
                type: "command",
                command: "npx purr-code-hook start",
                async: true,
                timeout: 5,
              },
            ],
          },
        ],
        Stop: [],
        StopFailure: [],
        SessionEnd: [],
      },
    };
    const issues = validateHooksManifest(bad);
    expect(issues.some((i) => i.path.includes("matcher"))).toBe(true);
    expect(issues.some((i) => i.message.includes("node"))).toBe(true);
  });
});

describe("preparePluginData (PC-401)", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length) {
      try {
        await cleanups.pop()?.();
      } catch {
        /* ignore */
      }
    }
  });

  it("writes config + WAV cache under CLAUDE_PLUGIN_DATA", async () => {
    const root = await mkdtemp(join(tmpdir(), "purr-plugin-"));
    cleanups.push(async () => rm(root, { recursive: true, force: true }));

    const pluginRoot = join(root, "plugin");
    const pluginData = join(root, "data");
    const soundsDir = join(pluginRoot, "sounds");
    await mkdir(soundsDir, { recursive: true });

    const srcOgg = join(repoRoot, "sounds", "sleepy.ogg");
    const srcWav = join(repoRoot, "sounds", "sleepy.wav");
    await copyFile(srcOgg, join(soundsDir, "sleepy.ogg"));
    await copyFile(srcWav, join(soundsDir, "sleepy.wav"));
    await writeFile(
      join(soundsDir, "sleepy.license.json"),
      JSON.stringify({ preset: "sleepy", license: "CC0-1.0" }),
    );

    const env = {
      CLAUDE_PLUGIN_ROOT: pluginRoot,
      CLAUDE_PLUGIN_DATA: pluginData,
    };

    const result = await preparePluginData({ env, sidecarBin: null });
    expect(result.pluginData).toBe(pluginData);
    expect(result.soundName).toBe("sleepy");
    expect(await isWavFile(result.wavCache.wavPath)).toBe(true);
    expect(result.wavCache.method).toMatch(/copy-wav|sibling-twin|cached/);

    const cfg = JSON.parse(await readFile(join(pluginData, "config.json"), "utf8")) as {
      sound: string;
    };
    expect(cfg.sound).toBe("sleepy");
    expect(await readFile(join(pluginData, "sounds", "sleepy.license.json"), "utf8")).toContain(
      "CC0",
    );

    // Idempotent second run
    const again = await preparePluginData({ env, sidecarBin: null });
    expect(again.wavCache.created).toBe(false);
    expect(again.wavCache.method).toBe("cached");
  });

  it("throws when CLAUDE_PLUGIN_DATA unset", async () => {
    await expect(preparePluginData({ env: {} })).rejects.toThrow(/CLAUDE_PLUGIN_DATA/);
  });
});
