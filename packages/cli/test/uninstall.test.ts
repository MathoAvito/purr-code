import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/cli/runCli.js";
import {
  parseUninstallArgs,
  runUninstall,
  stableMarketplaceDir,
  type ClaudePluginOps,
} from "../src/install/index.js";

describe("uninstall (PC-403)", () => {
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
    const home = await mkdtemp(join(tmpdir(), "purr-uninstall-"));
    cleanups.push(async () => rm(home, { recursive: true, force: true }));
    return home;
  }

  function mockClaude(state: {
    installed: string[];
    markets: string[];
    uninstalls: Array<{ id: string; keepData?: boolean }>;
    marketRemoves: string[];
  }): ClaudePluginOps {
    return {
      probeClaude: () => Promise.resolve({ present: true as const, version: "2.1.215" }),
      marketplaceList: () => Promise.resolve([...state.markets]),
      marketplaceAdd: () => Promise.resolve(),
      marketplaceRemove: (name) => {
        state.marketRemoves.push(name);
        state.markets = state.markets.filter((m) => m !== name);
        return Promise.resolve();
      },
      pluginList: () => Promise.resolve([...state.installed]),
      pluginInstall: () => Promise.resolve(),
      pluginUninstall: (id, opts) => {
        state.uninstalls.push({ id, ...(opts?.keepData ? { keepData: true } : {}) });
        state.installed = state.installed.filter((x) => x !== id);
        return Promise.resolve();
      },
    };
  }

  it("parses uninstall flags", () => {
    expect(parseUninstallArgs(["--keep-data", "--purge"])).toMatchObject({
      ok: true,
      keepData: true,
      purge: true,
    });
    expect(parseUninstallArgs(["--nope"]).ok).toBe(false);
  });

  it("install → uninstall leaves no plugin/runtime/data residue", async () => {
    const home = await tempHome();
    const runtimeDir = join(home, "runtime");
    const pluginData = join(home, ".claude", "plugins", "data", "purrcode-purrcode");
    await mkdir(pluginData, { recursive: true });
    await writeFile(join(pluginData, "config.json"), '{"sound":"sleepy"}\n');
    await mkdir(runtimeDir, { recursive: true });
    await writeFile(join(runtimeDir, "daemon.pid"), "12345\n");
    await writeFile(join(runtimeDir, "registry.json"), "{}\n");

    const state = {
      installed: ["purrcode@purrcode"],
      markets: ["purrcode"],
      uninstalls: [] as Array<{ id: string; keepData?: boolean }>,
      marketRemoves: [] as string[],
    };
    const lines: string[] = [];

    const result = await runUninstall({
      home,
      env: { NO_COLOR: "1", HOME: home, PURRCODE_RUNTIME_DIR: runtimeDir },
      claude: mockClaude(state),
      stopDaemon: () => Promise.resolve(["daemon:shutdown"]),
      stdout: (l) => lines.push(l),
      stderr: () => undefined,
    });

    expect(result.exitCode).toBe(0);
    expect(state.uninstalls).toEqual([{ id: "purrcode@purrcode" }]);
    expect(state.marketRemoves).toEqual(["purrcode"]);
    expect(existsSync(pluginData)).toBe(false);
    expect(existsSync(runtimeDir)).toBe(false);
    expect(lines.some((l) => l.includes("Removed plugin"))).toBe(true);
  });

  it("removes the stable marketplace copy", async () => {
    const home = await tempHome();
    const env = { NO_COLOR: "1", HOME: home, PURRCODE_RUNTIME_DIR: join(home, "runtime") };
    const stable = stableMarketplaceDir({ env, home });
    await mkdir(join(stable, ".claude-plugin"), { recursive: true });
    await writeFile(join(stable, ".claude-plugin", "marketplace.json"), "{}\n");

    const state = {
      installed: [] as string[],
      markets: [] as string[],
      uninstalls: [] as Array<{ id: string; keepData?: boolean }>,
      marketRemoves: [] as string[],
    };
    const result = await runUninstall({
      home,
      env,
      claude: mockClaude(state),
      stopDaemon: () => Promise.resolve([]),
      stdout: () => undefined,
      stderr: () => undefined,
    });

    expect(result.exitCode).toBe(0);
    expect(existsSync(stable)).toBe(false);
    expect(result.removed).toContain(`marketplace-files:${stable}`);
  });

  it("--keep-data retains plugin data; --purge removes imported/", async () => {
    const home = await tempHome();
    const runtimeDir = join(home, "runtime");
    const pluginData = join(home, ".claude", "plugins", "data", "purrcode-purrcode");
    const imported = join(pluginData, "imported");
    await mkdir(imported, { recursive: true });
    await writeFile(join(pluginData, "config.json"), "{}\n");
    await writeFile(join(imported, "custom.wav"), "x");

    const state = {
      installed: ["purrcode@purrcode"],
      markets: ["purrcode"],
      uninstalls: [] as Array<{ id: string; keepData?: boolean }>,
      marketRemoves: [] as string[],
    };

    const result = await runUninstall({
      home,
      env: { NO_COLOR: "1", HOME: home, PURRCODE_RUNTIME_DIR: runtimeDir },
      claude: mockClaude(state),
      keepData: true,
      purge: true,
      stopDaemon: () => Promise.resolve([]),
      stdout: () => undefined,
      stderr: () => undefined,
    });

    expect(result.exitCode).toBe(0);
    expect(state.uninstalls[0]?.keepData).toBe(true);
    expect(existsSync(pluginData)).toBe(true);
    expect(existsSync(join(pluginData, "config.json"))).toBe(true);
    expect(existsSync(imported)).toBe(false);
  });

  it("is idempotent when nothing is installed", async () => {
    const home = await tempHome();
    const runtimeDir = join(home, "runtime");
    const state = {
      installed: [] as string[],
      markets: [] as string[],
      uninstalls: [] as Array<{ id: string; keepData?: boolean }>,
      marketRemoves: [] as string[],
    };
    const lines: string[] = [];

    const result = await runUninstall({
      home,
      env: { NO_COLOR: "1", HOME: home, PURRCODE_RUNTIME_DIR: runtimeDir },
      claude: mockClaude(state),
      stopDaemon: () => Promise.resolve([]),
      stdout: (l) => lines.push(l),
      stderr: () => undefined,
    });

    expect(result.exitCode).toBe(0);
    expect(result.alreadyClean).toBe(true);
    expect(state.uninstalls).toEqual([]);
    expect(lines.some((l) => l.includes("already clean") || l.includes("not installed"))).toBe(
      true,
    );
  });

  it("wires through `purrcode uninstall` CLI", async () => {
    const home = await tempHome();
    const runtimeDir = join(home, "runtime");
    const state = {
      installed: ["purrcode@purrcode"],
      markets: ["purrcode"],
      uninstalls: [] as Array<{ id: string; keepData?: boolean }>,
      marketRemoves: [] as string[],
    };

    const res = await runCli({
      argv: ["uninstall", "--keep-data"],
      env: { NO_COLOR: "1", HOME: home, PURRCODE_RUNTIME_DIR: runtimeDir },
      stdout: () => undefined,
      stderr: () => undefined,
      uninstallDeps: {
        home,
        claude: mockClaude(state),
        stopDaemon: () => Promise.resolve([]),
      },
    });

    expect(res.exitCode).toBe(0);
    expect(state.uninstalls).toEqual([{ id: "purrcode@purrcode", keepData: true }]);
  });
});
