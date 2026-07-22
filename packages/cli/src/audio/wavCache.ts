import { createHash } from "node:crypto";
import { copyFile, mkdir, open, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import { resolveSidecarBinaryPath } from "./sidecar/resolveBinary.js";
import { resolveSoundsDirPath, type ResolveDataDirOptions } from "./dataDir.js";

const WAV_MAGIC = Buffer.from("RIFF");
const WAVE_MAGIC = Buffer.from("WAVE");

export type EnsureWavCacheOptions = ResolveDataDirOptions & {
  /** Absolute path to the source sound (OGG/WAV/…). */
  sourcePath: string;
  /** Sound name used for the cache filename (sanitized). Default: basename without ext. */
  soundName?: string;
  /** Override sidecar binary for --export. `null` disables sidecar. */
  sidecarBin?: string | null;
  /** When true (default), fall back to a sibling `.wav` twin next to the source. */
  allowSiblingTwin?: boolean;
};

export type WavCacheResult = {
  wavPath: string;
  created: boolean;
  method: "cached" | "copy-wav" | "sidecar-export" | "sibling-twin";
};

/** True when buffer looks like a PCM WAV (RIFF….WAVE). */
export function isWavBuffer(buf: Buffer): boolean {
  return (
    buf.length >= 12 &&
    buf.subarray(0, 4).equals(WAV_MAGIC) &&
    buf.subarray(8, 12).equals(WAVE_MAGIC)
  );
}

export async function isWavFile(path: string): Promise<boolean> {
  try {
    const fh = await open(path, "r");
    try {
      const buf = Buffer.alloc(12);
      const { bytesRead } = await fh.read(buf, 0, 12, 0);
      return bytesRead >= 12 && isWavBuffer(buf);
    } finally {
      await fh.close();
    }
  } catch {
    return false;
  }
}

export function sanitizeSoundName(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base.slice(0, 64) || "sound";
}

function cacheWavPath(soundsDir: string, soundName: string): string {
  return join(soundsDir, `${soundName}.wav`);
}

function siblingTwinPath(sourcePath: string): string {
  const ext = extname(sourcePath);
  if (ext.toLowerCase() === ".wav") return sourcePath;
  return `${sourcePath.slice(0, -ext.length)}.wav`;
}

async function fileFingerprint(path: string): Promise<string> {
  const st = await stat(path);
  const h = createHash("sha256");
  h.update(`${st.size}:${Math.trunc(st.mtimeMs)}:`);
  if (st.size <= 64 * 1024) {
    h.update(await readFile(path));
  } else {
    const fh = await open(path, "r");
    try {
      const buf = Buffer.alloc(4096);
      const { bytesRead } = await fh.read(buf, 0, 4096, 0);
      h.update(buf.subarray(0, bytesRead));
    } finally {
      await fh.close();
    }
  }
  return h.digest("hex").slice(0, 16);
}

async function readStamp(wavPath: string): Promise<string | null> {
  try {
    return (await readFile(`${wavPath}.stamp`, "utf8")).trim();
  } catch {
    return null;
  }
}

async function writeStamp(wavPath: string, fingerprint: string): Promise<void> {
  await writeFile(`${wavPath}.stamp`, `${fingerprint}\n`, "utf8");
}

async function runSidecarExport(bin: string, sourcePath: string, outPath: string): Promise<void> {
  const tmp = `${outPath}.${process.pid}.tmp`;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(bin, ["--export", sourcePath, tmp], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
    });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`sidecar --export failed (${code}): ${stderr.trim()}`));
    });
  });
  await rename(tmp, outPath);
}

/**
 * Ensure a canonical WAV exists for `sourcePath` in the data sounds directory.
 * Idempotent: skips work when a valid cache stamp matches the source fingerprint.
 *
 * Order: cached → copy if source is WAV → sidecar --export → sibling `.wav` twin.
 */
export async function ensureWavCache(options: EnsureWavCacheOptions): Promise<WavCacheResult> {
  const sourcePath = options.sourcePath;
  const soundName = sanitizeSoundName(
    options.soundName ?? basename(sourcePath, extname(sourcePath)),
  );
  const soundsDir = resolveSoundsDirPath(options);
  await mkdir(soundsDir, { recursive: true });
  const wavPath = cacheWavPath(soundsDir, soundName);
  const fp = await fileFingerprint(sourcePath);
  const stamp = await readStamp(wavPath);

  if (stamp === fp && (await isWavFile(wavPath))) {
    return { wavPath, created: false, method: "cached" };
  }

  if (await isWavFile(sourcePath)) {
    await copyFile(sourcePath, wavPath);
    await writeStamp(wavPath, fp);
    return { wavPath, created: true, method: "copy-wav" };
  }

  const bin =
    options.sidecarBin === null
      ? null
      : (options.sidecarBin ??
        resolveSidecarBinaryPath({
          ...(options.env !== undefined ? { env: options.env } : {}),
        }));
  if (bin) {
    try {
      await runSidecarExport(bin, sourcePath, wavPath);
      if (await isWavFile(wavPath)) {
        await writeStamp(wavPath, fp);
        return { wavPath, created: true, method: "sidecar-export" };
      }
    } catch {
      // fall through to sibling twin
    }
  }

  const twin = siblingTwinPath(sourcePath);
  if ((options.allowSiblingTwin ?? true) && twin !== sourcePath && (await isWavFile(twin))) {
    await copyFile(twin, wavPath);
    await writeStamp(wavPath, fp);
    return { wavPath, created: true, method: "sibling-twin" };
  }

  throw new Error(
    `ensureWavCache: cannot produce WAV for ${sourcePath} (no sidecar export / twin)`,
  );
}

export type ResolveBundledSoundOptions = {
  /** Explicit sounds tree root (repo root or plugin root). */
  root?: string;
  /** @deprecated Prefer `root`. Accepted for backward compatibility. */
  repoRoot?: string;
  env?: NodeJS.ProcessEnv;
  /** Override `CLAUDE_PLUGIN_ROOT` (tests). */
  pluginRoot?: string;
};

/**
 * Resolve bundled `sounds/<name>.{ogg,wav}`.
 *
 * Order: explicit root → `CLAUDE_PLUGIN_ROOT` → monorepo/plugin-relative walk
 * from this module (`../../../../` lands at repo root in monorepo, or plugin
 * root when running from an assembled plugin `dist/`).
 */
export function resolveBundledSoundPath(
  soundName: string,
  rootOrOptions?: string | ResolveBundledSoundOptions,
): { ogg: string; wav: string; preferred: string; root: string } {
  const opts: ResolveBundledSoundOptions =
    typeof rootOrOptions === "string" ? { root: rootOrOptions } : (rootOrOptions ?? {});
  const env = opts.env ?? process.env;
  const pluginRoot = opts.pluginRoot ?? (env.CLAUDE_PLUGIN_ROOT?.trim() || undefined);
  const root =
    opts.root ??
    opts.repoRoot ??
    pluginRoot ??
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
  const name = sanitizeSoundName(soundName);
  const ogg = join(root, "sounds", `${name}.ogg`);
  const wav = join(root, "sounds", `${name}.wav`);
  return { ogg, wav, preferred: ogg, root };
}
