import { mkdir, mkdtemp, readFile, rm, writeFile, copyFile, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { existsSync } from "node:fs";

import { FakeAudioBackend } from "../src/audio/fake/index.js";
import { runCli } from "../src/cli/runCli.js";
import {
  createClaudePluginOps,
  detectCliHint,
  runInstall,
  stableMarketplaceDir,
  syncStableMarketplace,
  type ClaudePluginOps,
} from "../src/install/index.js";
import { isWavFile } from "../src/audio/wavCache.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

describe("install (PC-402)", () => {
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

  async function tempHome(): Promise<string> {
    const home = await mkdtemp(join(tmpdir(), "purr-install-"));
    cleanups.push(async () => rm(home, { recursive: true, force: true }));
    return home;
  }

  async function fixtureMarketplace(home: string): Promise<string> {
    const mp = join(home, "marketplace");
    const plugin = join(mp, "plugins", "purrcode");
    await mkdir(join(mp, ".claude-plugin"), { recursive: true });
    await mkdir(join(plugin, ".claude-plugin"), { recursive: true });
    await mkdir(join(plugin, "hooks"), { recursive: true });
    await mkdir(join(plugin, "sounds"), { recursive: true });
    await mkdir(join(plugin, "dist"), { recursive: true });

    await writeFile(
      join(mp, ".claude-plugin", "marketplace.json"),
      JSON.stringify({
        name: "purrcode",
        owner: { name: "PurrCode" },
        plugins: [{ name: "purrcode", source: "./plugins/purrcode" }],
      }),
    );
    await writeFile(
      join(plugin, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "purrcode", version: "0.0.0" }),
    );
    // Copy real hooks.json from the production plugin package.
    await cp(
      join(
        repoRoot,
        "packages",
        "plugin",
        "marketplace",
        "plugins",
        "purrcode",
        "hooks",
        "hooks.json",
      ),
      join(plugin, "hooks", "hooks.json"),
    );
    await copyFile(join(repoRoot, "sounds", "sleepy.ogg"), join(plugin, "sounds", "sleepy.ogg"));
    await copyFile(join(repoRoot, "sounds", "sleepy.wav"), join(plugin, "sounds", "sleepy.wav"));
    await writeFile(
      join(plugin, "sounds", "sleepy.license.json"),
      JSON.stringify({ preset: "sleepy", license: "CC0-1.0" }),
    );
    await writeFile(join(plugin, "dist", "hook.js"), "// fixture\n");
    return mp;
  }

  function mockClaude(state: {
    installed: string[];
    markets: string[];
    installs: string[];
    marketAdds: string[];
  }): ClaudePluginOps {
    return {
      probeClaude: () => Promise.resolve({ present: true as const, version: "2.1.215" }),
      marketplaceList: () => Promise.resolve([...state.markets]),
      marketplaceAdd: (source) => {
        state.marketAdds.push(source);
        state.markets.push("purrcode");
        return Promise.resolve();
      },
      marketplaceRemove: () => Promise.resolve(),
      pluginList: () => Promise.resolve([...state.installed]),
      pluginInstall: (id) => {
        state.installs.push(id);
        state.installed.push(id);
        return Promise.resolve();
      },
      pluginUninstall: () => Promise.resolve(),
    };
  }

  it("detectCliHint maps npx cache paths to `npx purr-code`", () => {
    expect(detectCliHint("/home/u/.npm/_npx/abc123/node_modules/purr-code/dist/cli.js")).toBe(
      "npx purr-code",
    );
    expect(detectCliHint("C:\\Users\\u\\AppData\\Local\\npm-cache\\_npx\\x\\cli.js")).toBe(
      "npx purr-code",
    );
    expect(detectCliHint("/usr/local/bin/purrcode")).toBe("purrcode");
    expect(detectCliHint(undefined)).toBe("purrcode");
  });

  it("prints npx-prefixed follow-ups and a global-install tip for npx users", async () => {
    const home = await tempHome();
    const marketplacePath = await fixtureMarketplace(home);
    const state = {
      installed: [] as string[],
      markets: [] as string[],
      installs: [] as string[],
      marketAdds: [] as string[],
    };
    const lines: string[] = [];
    const result = await runInstall({
      home,
      env: { NO_COLOR: "1", HOME: home, PURRCODE_FAKE_AUDIO: "1" },
      marketplacePath,
      claude: mockClaude(state),
      sidecarBin: null,
      cliHint: "npx purr-code",
      selectBackend: async () => {
        const backend = new FakeAudioBackend({
          enabled: true,
          logPath: join(home, "fake.jsonl"),
        });
        return {
          backend,
          capabilities: await backend.detect(),
          probes: [{ tier: "fake", name: "fake", present: true }],
        };
      },
      stdout: (l) => lines.push(l),
      stderr: () => {},
    });
    expect(result.exitCode).toBe(0);
    expect(lines.some((l) => l.includes("npx purr-code preview"))).toBe(true);
    expect(lines.some((l) => l.includes("npm install -g purr-code"))).toBe(true);
  });

  it("installs plugin via mocked registration layer and prepares WAV cache", async () => {
    const home = await tempHome();
    const marketplacePath = await fixtureMarketplace(home);
    const state = {
      installed: [] as string[],
      markets: [] as string[],
      installs: [] as string[],
      marketAdds: [] as string[],
    };
    const lines: string[] = [];
    const errLines: string[] = [];

    const result = await runInstall({
      home,
      env: { NO_COLOR: "1", HOME: home, PURRCODE_FAKE_AUDIO: "1" },
      marketplacePath,
      claude: mockClaude(state),
      sidecarBin: null,
      selectBackend: async () => {
        const backend = new FakeAudioBackend({
          enabled: true,
          logPath: join(home, "fake.jsonl"),
        });
        return {
          backend,
          capabilities: await backend.detect(),
          probes: [{ tier: "fake", name: "fake", present: true }],
        };
      },
      stdout: (l) => lines.push(l),
      stderr: (l) => errLines.push(l),
    });

    expect(result.exitCode).toBe(0);
    expect(result.alreadyInstalled).toBe(false);
    expect(state.marketAdds.length).toBe(1);
    expect(state.installs).toEqual(["purrcode@purrcode"]);
    expect(lines.some((l) => l.includes("Detected Claude Code"))).toBe(true);
    expect(lines.some((l) => l.includes("Installed PurrCode plugin"))).toBe(true);
    expect(lines.some((l) => l.includes("default purr"))).toBe(true);
    expect(lines.some((l) => l.includes("tier"))).toBe(true);
    expect(lines.some((l) => l.includes("purrcode preview"))).toBe(true);
    expect(lines.some((l) => l.includes("purrcode volume"))).toBe(true);
    expect(lines.some((l) => l.includes("Restart Claude Code"))).toBe(true);

    const wav = join(
      home,
      ".claude",
      "plugins",
      "data",
      "purrcode-purrcode",
      "sounds",
      "sleepy.wav",
    );
    expect(await isWavFile(wav)).toBe(true);
    const cfg = JSON.parse(
      await readFile(
        join(home, ".claude", "plugins", "data", "purrcode-purrcode", "config.json"),
        "utf8",
      ),
    ) as { sound: string };
    expect(cfg.sound).toBe("sleepy");
  });

  it("is idempotent when plugin already installed", async () => {
    const home = await tempHome();
    const marketplacePath = await fixtureMarketplace(home);
    const state = {
      installed: ["purrcode@purrcode"],
      markets: ["purrcode"],
      installs: [] as string[],
      marketAdds: [] as string[],
    };
    const lines: string[] = [];

    const result = await runInstall({
      home,
      env: { NO_COLOR: "1", HOME: home, PURRCODE_FAKE_AUDIO: "1" },
      marketplacePath,
      claude: mockClaude(state),
      sidecarBin: null,
      selectBackend: async () => {
        const backend = new FakeAudioBackend({
          enabled: true,
          logPath: join(home, "fake.jsonl"),
        });
        return {
          backend,
          capabilities: await backend.detect(),
          probes: [{ tier: "fake", name: "fake", present: true }],
        };
      },
      stdout: (l) => lines.push(l),
      stderr: () => undefined,
    });

    expect(result.exitCode).toBe(0);
    expect(result.alreadyInstalled).toBe(true);
    expect(state.installs).toEqual([]);
    expect(state.marketAdds).toEqual([]);
    expect(lines.some((l) => l.includes("already installed"))).toBe(true);
  });

  it("copies a packaged marketplace to the stable dir and registers that path", async () => {
    const home = await tempHome();
    const packagedPath = await fixtureMarketplace(home);
    const env = { NO_COLOR: "1", HOME: home, PURRCODE_FAKE_AUDIO: "1" };
    const state = {
      installed: [] as string[],
      markets: [] as string[],
      installs: [] as string[],
      marketAdds: [] as string[],
    };

    const result = await runInstall({
      home,
      env,
      marketplaceSource: { path: packagedPath, kind: "packaged" },
      claude: mockClaude(state),
      sidecarBin: null,
      selectBackend: async () => {
        const backend = new FakeAudioBackend({
          enabled: true,
          logPath: join(home, "fake.jsonl"),
        });
        return {
          backend,
          capabilities: await backend.detect(),
          probes: [{ tier: "fake", name: "fake", present: true }],
        };
      },
      stdout: () => undefined,
      stderr: () => undefined,
    });

    const stable = stableMarketplaceDir({ env, home });
    expect(result.exitCode).toBe(0);
    expect(result.marketplacePath).toBe(stable);
    expect(state.marketAdds).toEqual([stable]);
    expect(existsSync(join(stable, ".claude-plugin", "marketplace.json"))).toBe(true);
    expect(existsSync(join(stable, "plugins", "purrcode", "hooks", "hooks.json"))).toBe(true);
  });

  it("syncStableMarketplace replaces a previous copy", async () => {
    const home = await tempHome();
    const packagedPath = await fixtureMarketplace(home);
    const env = { HOME: home };

    const first = await syncStableMarketplace({ sourcePath: packagedPath, env, home });
    await writeFile(join(first, "stale-marker.txt"), "old\n");

    const second = await syncStableMarketplace({ sourcePath: packagedPath, env, home });
    expect(second).toBe(first);
    expect(existsSync(join(second, "stale-marker.txt"))).toBe(false);
    expect(existsSync(join(second, "plugins", "purrcode", "hooks", "hooks.json"))).toBe(true);
    // Re-syncing from the stable dir itself is a no-op, not a self-copy.
    await expect(syncStableMarketplace({ sourcePath: second, env, home })).resolves.toBe(second);
  });

  it("fails clearly when Claude Code is missing", async () => {
    const home = await tempHome();
    const errLines: string[] = [];
    const result = await runInstall({
      home,
      env: { NO_COLOR: "1", HOME: home },
      marketplacePath: await fixtureMarketplace(home),
      claude: {
        probeClaude: () =>
          Promise.resolve({ present: false as const, detail: "`claude` not found on PATH" }),
        marketplaceList: () => Promise.resolve([]),
        marketplaceAdd: () => Promise.resolve(),
        marketplaceRemove: () => Promise.resolve(),
        pluginList: () => Promise.resolve([]),
        pluginInstall: () => Promise.resolve(),
        pluginUninstall: () => Promise.resolve(),
      },
      stdout: () => undefined,
      stderr: (l) => errLines.push(l),
    });
    expect(result.exitCode).toBe(1);
    expect(errLines.some((l) => l.includes("Claude Code not detected"))).toBe(true);
    expect(errLines.some((l) => l.includes("Fix:"))).toBe(true);
  });

  it("wires through `purrcode install` CLI entry", async () => {
    const home = await tempHome();
    const marketplacePath = await fixtureMarketplace(home);
    const state = {
      installed: [] as string[],
      markets: [] as string[],
      installs: [] as string[],
      marketAdds: [] as string[],
    };
    const lines: string[] = [];

    const res = await runCli({
      argv: ["install"],
      env: { NO_COLOR: "1", HOME: home, PURRCODE_FAKE_AUDIO: "1" },
      stdout: (l) => lines.push(l),
      stderr: () => undefined,
      installDeps: {
        home,
        marketplacePath,
        claude: mockClaude(state),
        sidecarBin: null,
        selectBackend: async () => {
          const backend = new FakeAudioBackend({
            enabled: true,
            logPath: join(home, "fake.jsonl"),
          });
          return {
            backend,
            capabilities: await backend.detect(),
            probes: [{ tier: "fake", name: "fake", present: true }],
          };
        },
      },
    });

    expect(res.exitCode).toBe(0);
    expect(state.installs).toEqual(["purrcode@purrcode"]);
    expect(lines[0]).toContain("Installing PurrCode");
  });

  it("createClaudePluginOps uses exec-form runner (no shell)", async () => {
    const calls: string[][] = [];
    const ops = createClaudePluginOps({
      run: (args) => {
        calls.push(args);
        if (args[0] === "--version") {
          return Promise.resolve({ stdout: "2.1.215 (Claude Code)\n", stderr: "" });
        }
        if (args[0] === "plugin" && args[1] === "list") {
          return Promise.resolve({ stdout: "  ❯ purrcode@purrcode\n", stderr: "" });
        }
        if (args[0] === "plugin" && args[1] === "marketplace" && args[2] === "list") {
          return Promise.resolve({ stdout: "purrcode\n", stderr: "" });
        }
        return Promise.resolve({ stdout: "", stderr: "" });
      },
    });
    const probe = await ops.probeClaude();
    expect(probe).toEqual({ present: true, version: "2.1.215" });
    expect(await ops.pluginList()).toContain("purrcode@purrcode");
    expect(await ops.marketplaceList()).toContain("purrcode");
    expect(calls.every((c) => Array.isArray(c))).toBe(true);
  });
});
