import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { DEFAULT_CONFIG, type PurrCodeConfig } from "./defaults.js";
import { resolveConfigFilePath, type ResolveConfigDirOptions } from "./paths.js";
import { mergeConfig, normalizeConfig } from "./validate.js";

export type LoadConfigResult =
  | { ok: true; config: PurrCodeConfig; path: string; created: boolean }
  | { ok: false; config: PurrCodeConfig; path: string; reason: "symlink" | "unreadable" };

/**
 * Load config from disk. Missing → defaults (optionally write). Symlink → refuse
 * and return defaults without following (§13). Corrupt/invalid → defaults with
 * per-field fallback via {@link normalizeConfig}.
 */
export function loadConfig(
  options: ResolveConfigDirOptions & { writeDefaultsIfMissing?: boolean } = {},
): LoadConfigResult {
  const path = resolveConfigFilePath(options);
  const writeDefaults = options.writeDefaultsIfMissing ?? false;

  if (!existsSync(path)) {
    const config = normalizeConfig({ ...DEFAULT_CONFIG });
    if (writeDefaults) {
      try {
        writeConfigAtomic(path, config);
      } catch {
        // still return in-memory defaults
      }
    }
    return { ok: true, config, path, created: true };
  }

  try {
    const st = lstatSync(path);
    if (st.isSymbolicLink()) {
      return {
        ok: false,
        config: normalizeConfig({ ...DEFAULT_CONFIG }),
        path,
        reason: "symlink",
      };
    }
  } catch {
    return {
      ok: false,
      config: normalizeConfig({ ...DEFAULT_CONFIG }),
      path,
      reason: "unreadable",
    };
  }

  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return { ok: true, config: normalizeConfig(raw), path, created: false };
  } catch {
    return {
      ok: false,
      config: normalizeConfig({ ...DEFAULT_CONFIG }),
      path,
      reason: "unreadable",
    };
  }
}

/**
 * Atomic config write: temp + rename. Refuses if the target path is a symlink.
 * Preserves unknown keys already present on `config`.
 */
export function writeConfig(
  config: PurrCodeConfig,
  options: ResolveConfigDirOptions = {},
): { ok: true; path: string } | { ok: false; reason: "symlink" | "write-failed"; path: string } {
  const path = resolveConfigFilePath(options);
  if (existsSync(path)) {
    try {
      if (lstatSync(path).isSymbolicLink()) {
        return { ok: false, reason: "symlink", path };
      }
    } catch {
      return { ok: false, reason: "write-failed", path };
    }
  }
  try {
    writeConfigAtomic(path, normalizeConfig(config));
    return { ok: true, path };
  } catch {
    return { ok: false, reason: "write-failed", path };
  }
}

/** Apply a set-config patch, persist, and return the merged config. */
export function applyConfigPatch(
  current: PurrCodeConfig,
  patch: Record<string, unknown>,
  options: ResolveConfigDirOptions = {},
): { config: PurrCodeConfig; written: boolean } {
  const next = mergeConfig(current, patch);
  const result = writeConfig(next, options);
  return { config: next, written: result.ok };
}

function writeConfigAtomic(path: string, config: PurrCodeConfig): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  // Refuse to replace a symlink that appeared between checks.
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
    try {
      // best-effort cleanup of temp
      writeFileSync(tmp, "");
    } catch {
      /* ignore */
    }
    throw new Error("config path is a symlink");
  }
  renameSync(tmp, path);
}
