import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { PLUGIN_ID } from "./paths.js";

const execFileAsync = promisify(execFile);

export type ClaudeProbeResult =
  { present: true; version: string } | { present: false; detail: string };

export type ClaudePluginOps = {
  probeClaude: () => Promise<ClaudeProbeResult>;
  marketplaceList: () => Promise<string[]>;
  marketplaceAdd: (sourcePath: string) => Promise<void>;
  marketplaceRemove: (name: string) => Promise<void>;
  pluginList: () => Promise<string[]>;
  pluginInstall: (pluginId: string) => Promise<void>;
  pluginUninstall: (pluginId: string, opts?: { keepData?: boolean }) => Promise<void>;
};

export type RunClaudeOptions = {
  env?: NodeJS.ProcessEnv;
  /** Inject for tests. */
  run?: (args: string[]) => Promise<{ stdout: string; stderr: string }>;
};

async function defaultRun(
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync("claude", args, {
    encoding: "utf8",
    env,
    timeout: 60_000,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
  });
  return { stdout: stdout ?? "", stderr: stderr ?? "" };
}

/** Create real Claude Code CLI ops (exec form; never shell). */
export function createClaudePluginOps(options: RunClaudeOptions = {}): ClaudePluginOps {
  const env = options.env ?? process.env;
  const run = options.run ?? ((args) => defaultRun(args, env));

  return {
    async probeClaude() {
      try {
        const { stdout, stderr } = await run(["--version"]);
        const text = `${stdout}\n${stderr}`.trim();
        const match = text.match(/(\d+\.\d+\.\d+)/);
        if (!match) {
          return { present: true, version: text.split("\n")[0]?.trim() || "unknown" };
        }
        return { present: true, version: match[1]! };
      } catch (e) {
        const err = e as NodeJS.ErrnoException & { stderr?: string };
        if (err.code === "ENOENT") {
          return {
            present: false,
            detail: "`claude` not found on PATH",
          };
        }
        return {
          present: false,
          detail: err.stderr?.trim() || err.message || "claude --version failed",
        };
      }
    },

    async marketplaceList() {
      const { stdout } = await run(["plugin", "marketplace", "list"]);
      return parseNameLines(stdout);
    },

    async marketplaceAdd(sourcePath: string) {
      await run(["plugin", "marketplace", "add", sourcePath]);
    },

    async marketplaceRemove(name: string) {
      await run(["plugin", "marketplace", "remove", name]);
    },

    async pluginList() {
      const { stdout } = await run(["plugin", "list"]);
      // Prefer exact plugin@marketplace tokens when present.
      const ids = new Set<string>();
      for (const line of stdout.split(/\r?\n/)) {
        const m = line.match(/([A-Za-z0-9._-]+@[A-Za-z0-9._-]+)/);
        if (m) ids.add(m[1]!);
        else if (/purrcode/i.test(line)) ids.add(PLUGIN_ID);
      }
      return [...ids];
    },

    async pluginInstall(pluginId: string) {
      await run(["plugin", "install", pluginId, "--scope", "user"]);
    },

    async pluginUninstall(pluginId: string, opts: { keepData?: boolean } = {}) {
      const args = ["plugin", "uninstall", pluginId, "--scope", "user"];
      if (opts.keepData) args.push("--keep-data");
      await run(args);
    },
  };
}

function parseNameLines(stdout: string): string[] {
  const names: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // `claude plugin marketplace list` prints names; tolerate bullets.
    const cleaned = trimmed.replace(/^[-*❯>\d.)\s]+/, "").split(/\s+/)[0];
    if (cleaned && /^[A-Za-z0-9._-]+$/.test(cleaned)) names.push(cleaned);
  }
  return names;
}
