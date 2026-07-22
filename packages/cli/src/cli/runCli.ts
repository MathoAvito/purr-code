import { randomUUID } from "node:crypto";

import { ensureDaemonRunning, type EnsureDaemonResult } from "../daemon/spawn.js";
import { PROTOCOL_VERSION } from "../control/protocol.js";
import type { ControlPipeClient } from "../control/client.js";
import { applyConfigPatch, loadConfig, type ResolveConfigDirOptions } from "../config/index.js";
import { clampPerceptualVolume } from "../audio/perceptual.js";
import {
  selectAudioBackend,
  type SelectAudioBackendOptions,
  type SelectedAudioBackend,
} from "../audio/detect.js";
import { isFakeAudioEnabled } from "../audio/fake/index.js";
import { resolveBundledSoundPath } from "../audio/wavCache.js";
import { style } from "./style.js";
import type { DoctorDeps } from "./doctorChecks.js";

export type RunCliOptions = {
  argv?: string[];
  env?: NodeJS.ProcessEnv;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
  /** Inject ensureDaemon (tests). */
  ensureDaemon?: (opts?: Parameters<typeof ensureDaemonRunning>[0]) => Promise<EnsureDaemonResult>;
  configDir?: ResolveConfigDirOptions;
  /** Preview duration for CLI-local real-backend path (ms). */
  previewMs?: number;
  /** Inject backend selection for preview (tests / fake-bypass). */
  selectBackend?: (opts: SelectAudioBackendOptions) => Promise<SelectedAudioBackend>;
  /** Extra doctor deps (PC-307 fixture tests). */
  doctorDeps?: Partial<DoctorDeps>;
  /** Extra install deps (PC-402 fixture tests). */
  installDeps?: import("../install/install.js").InstallOptions;
};

export type RunCliResult = { exitCode: number };

const HELP = `PurrCode — Claude Code purrs while working

Usage:
  purrcode install
  purrcode on|off|mute|unmute
  purrcode status
  purrcode volume <0-100>
  purrcode preview [name]
  purrcode pspsps
  purrcode doctor
  purrcode help

Tips:
  install registers the Claude Code plugin (never touches settings.json).
  off during a turn fades the purr out immediately.
  preview plays ~10 seconds without needing a Claude session
  (uses volume ≥ 50 so it is audible; turn default 20 is very quiet).
  doctor explains why the cat is silent.
`;

/**
 * MVP CLI surface (PC-306). Returns an exit code; never throws to callers.
 */
export async function runCli(options: RunCliOptions = {}): Promise<RunCliResult> {
  const argv = options.argv ?? process.argv.slice(2);
  const env = options.env ?? process.env;
  const out = options.stdout ?? ((line: string) => process.stdout.write(`${line}\n`));
  const err = options.stderr ?? ((line: string) => process.stderr.write(`${line}\n`));
  const ensure = options.ensureDaemon ?? ensureDaemonRunning;
  const cmd = (argv[0] ?? "help").toLowerCase();
  const ctx: Ctx = {
    env,
    out,
    err,
    ensure,
    ...(options.configDir !== undefined ? { configDir: options.configDir } : {}),
  };

  try {
    switch (cmd) {
      case "help":
      case "--help":
      case "-h":
        out(HELP.trimEnd());
        return { exitCode: 0 };
      case "on":
      case "unmute":
        return await setEnabled(true, ctx);
      case "off":
      case "mute":
        return await setEnabled(false, ctx);
      case "volume":
        return await setVolume(argv[1], ctx);
      case "status":
        return await showStatus(ctx);
      case "preview":
      case "pspsps":
        return await previewSound(cmd === "pspsps" ? undefined : argv[1], {
          ...ctx,
          previewMs: options.previewMs ?? 10_000,
          selectBackend: options.selectBackend ?? selectAudioBackend,
        });
      case "doctor":
        return await (
          await import("./doctor.js")
        ).runDoctor({
          env,
          out,
          err,
          ensure,
          ...(options.configDir !== undefined ? { configDir: options.configDir } : {}),
          ...(options.doctorDeps !== undefined ? { deps: options.doctorDeps } : {}),
        });
      case "install": {
        const installDeps = options.installDeps ?? {};
        const result = await (
          await import("../install/install.js")
        ).runInstall({
          env,
          stdout: installDeps.stdout ?? out,
          stderr: installDeps.stderr ?? err,
          ...installDeps,
        });
        return { exitCode: result.exitCode };
      }
      default:
        err(style.err(`Unknown command: ${cmd}`, env));
        err("Run `purrcode help` for the list of commands.");
        return { exitCode: 1 };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    err(style.err(`Something went wrong: ${msg}`, env));
    err(style.dim("Try `purrcode doctor` if the cat is silent.", env));
    return { exitCode: 1 };
  }
}

type Ctx = {
  env: NodeJS.ProcessEnv;
  out: (line: string) => void;
  err: (line: string) => void;
  ensure: NonNullable<RunCliOptions["ensureDaemon"]>;
  configDir?: ResolveConfigDirOptions;
};

async function withDaemon<T>(ctx: Ctx, fn: (client: ControlPipeClient) => Promise<T>): Promise<T> {
  const { client } = await ctx.ensure({ env: ctx.env });
  try {
    return await fn(client);
  } finally {
    client.close();
  }
}

async function setEnabled(enabled: boolean, ctx: Ctx): Promise<RunCliResult> {
  const loaded = loadConfig({ ...ctx.configDir, writeDefaultsIfMissing: true });
  applyConfigPatch(loaded.config, { enabled }, ctx.configDir);
  await withDaemon(ctx, async (client) => {
    await client.request({
      v: PROTOCOL_VERSION,
      op: "set-config",
      id: randomUUID(),
      config: { enabled },
    });
  });
  ctx.out(
    enabled
      ? style.ok("Purr enabled. The cat will hum on the next Claude turn.", ctx.env)
      : style.ok("Purr muted. Active playback fades out immediately.", ctx.env),
  );
  return { exitCode: 0 };
}

async function setVolume(raw: string | undefined, ctx: Ctx): Promise<RunCliResult> {
  if (raw === undefined || raw === "") {
    ctx.err(style.err("Usage: purrcode volume <0-100>", ctx.env));
    return { exitCode: 1 };
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    ctx.err(style.err(`Volume must be a number 0–100 (got ${raw}).`, ctx.env));
    return { exitCode: 1 };
  }
  const value = clampPerceptualVolume(n);
  const loaded = loadConfig({ ...ctx.configDir, writeDefaultsIfMissing: true });
  applyConfigPatch(loaded.config, { volume: value }, ctx.configDir);
  const res = await withDaemon(ctx, (client) =>
    client.request({
      v: PROTOCOL_VERSION,
      op: "volume",
      id: randomUUID(),
      value,
    }),
  );
  if (!res.ok) {
    ctx.err(style.err(res.error ?? "Daemon rejected volume change.", ctx.env));
    return { exitCode: 1 };
  }
  ctx.out(style.ok(`Volume set to ${value}.`, ctx.env));
  return { exitCode: 0 };
}

async function showStatus(ctx: Ctx): Promise<RunCliResult> {
  const disk = loadConfig({ ...ctx.configDir, writeDefaultsIfMissing: false }).config;
  let daemon: Record<string, unknown> | null = null;
  try {
    const res = await withDaemon(ctx, (client) =>
      client.request({ v: PROTOCOL_VERSION, op: "status", id: randomUUID() }),
    );
    if (res.ok && res.result && typeof res.result === "object") {
      daemon = res.result as Record<string, unknown>;
    }
  } catch {
    daemon = null;
  }

  const backend = (daemon?.backend ?? null) as Record<string, unknown> | null;
  const pid = typeof daemon?.pid === "number" ? daemon.pid : "?";
  const enabled = typeof daemon?.enabled === "boolean" ? daemon.enabled : disk.enabled;
  const sound = typeof daemon?.sound === "string" ? daemon.sound : disk.sound;
  const volume = typeof daemon?.volume === "number" ? daemon.volume : disk.volume;
  const phase = typeof daemon?.phase === "string" ? daemon.phase : "?";
  const sessions = typeof daemon?.sessions === "number" ? daemon.sessions : 0;
  const playing = typeof daemon?.playbackSessions === "number" ? daemon.playbackSessions : 0;
  const paused = typeof daemon?.pausedSessions === "number" ? daemon.pausedSessions : 0;
  const backendName = typeof backend?.name === "string" ? backend.name : "?";
  const backendTier = typeof backend?.tier === "string" ? backend.tier : "?";

  ctx.out(style.bold("PurrCode status", ctx.env));
  ctx.out(
    `  daemon:     ${daemon ? style.ok(`running (pid ${pid})`, ctx.env) : style.warn("not running", ctx.env)}`,
  );
  ctx.out(`  enabled:    ${enabled}`);
  ctx.out(`  sound:      ${sound}`);
  ctx.out(`  volume:     ${volume}`);
  if (daemon) {
    ctx.out(`  phase:      ${phase}`);
    ctx.out(`  sessions:   ${sessions} active (${playing} playing, ${paused} paused)`);
  }
  if (backend) {
    ctx.out(
      `  backend:    ${backendName} (tier ${backendTier}${backend.available === false ? ", unavailable" : ""})`,
    );
    ctx.out(
      `  caps:       loop=${Boolean(backend.loop)} fade=${Boolean(backend.fade)} runtimeVolume=${Boolean(backend.runtimeVolume)}`,
    );
  } else {
    ctx.out(`  backend:    ${style.dim("(unknown until daemon starts)", ctx.env)}`);
  }
  return { exitCode: 0 };
}

/** Preview uses at least this perceptual level so QA isn't silent at default 20. */
const PREVIEW_VOLUME_FLOOR = 50;

async function previewSound(
  name: string | undefined,
  ctx: Ctx & {
    previewMs: number;
    selectBackend: NonNullable<RunCliOptions["selectBackend"]>;
  },
): Promise<RunCliResult> {
  const cfg = loadConfig({ ...ctx.configDir }).config;
  const sound = name && name.length > 0 ? name : cfg.sound;
  const previewVolume = Math.max(cfg.volume, PREVIEW_VOLUME_FLOOR);

  // Prefer daemon preview when the daemon is not in fake-audio mode (real backends).
  if (!isFakeAudioEnabled(ctx.env)) {
    try {
      const res = await withDaemon(ctx, (client) =>
        client.request({
          v: PROTOCOL_VERSION,
          op: "preview",
          id: randomUUID(),
          sound,
          durationMs: ctx.previewMs,
        }),
      );
      if (res.ok) {
        const secs = Math.round(ctx.previewMs / 1000);
        ctx.out(
          style.ok(
            `Previewing "${sound}" for ~${secs}s (daemon; config volume ${cfg.volume}, preview plays at ≥${PREVIEW_VOLUME_FLOOR})…`,
            ctx.env,
          ),
        );
        if (cfg.volume < PREVIEW_VOLUME_FLOOR) {
          ctx.out(
            style.dim(
              `Tip: default volume ${cfg.volume} is very quiet for turns (−48 dB at 20). Preview temporarily uses ${PREVIEW_VOLUME_FLOOR}. For turns: purrcode volume 50`,
              ctx.env,
            ),
          );
        }
        // Stay alive for the daemon's preview window so the process doesn't look
        // "done" before audio has a chance to play.
        await new Promise((r) => setTimeout(r, ctx.previewMs));
        ctx.out(style.dim("Preview done.", ctx.env));
        return { exitCode: 0 };
      }
    } catch {
      // Fall through to CLI-local real-backend preview.
    }
  }

  // Bypass PURRCODE_FAKE_AUDIO so preview always targets a real tier (PC-306).
  const envNoFake = { ...ctx.env };
  delete envNoFake.PURRCODE_FAKE_AUDIO;
  const selected = await ctx.selectBackend({ env: envNoFake });
  if (!selected.capabilities.available) {
    ctx.err(
      style.err(
        "No audio backend available for preview. Install the sidecar or mpv, then retry.",
        ctx.env,
      ),
    );
    return { exitCode: 1 };
  }
  const soundPath = resolveBundledSoundPath(sound).preferred;
  ctx.out(
    style.ok(
      `Previewing "${sound}" via ${selected.capabilities.name} (tier ${selected.capabilities.tier}) at volume ${previewVolume}…`,
      ctx.env,
    ),
  );
  const handle = await selected.backend.play({
    soundPath,
    volume: previewVolume,
    fadeInMs: 0,
  });
  await new Promise((r) => setTimeout(r, ctx.previewMs));
  await selected.backend.stop(handle, 0);
  ctx.out(style.dim("Preview done.", ctx.env));
  return { exitCode: 0 };
}
