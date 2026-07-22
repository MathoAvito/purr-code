import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";

import { FakeAudioBackend, isFakeAudioEnabled } from "./fake/index.js";
import { NoneAudioBackend } from "./none/NoneAudioBackend.js";
import { SidecarAudioBackend } from "./sidecar/index.js";
import type { AudioBackend, BackendCapabilities, BackendTier } from "./types.js";

export type BackendProbe = {
  tier: BackendTier;
  name: string;
  /** True when the underlying binary/env would allow this tier. */
  present: boolean;
};

export type SelectAudioBackendOptions = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  arch?: string;
  /**
   * Optional factories for tiers whose adapters land in later stories.
   * When omitted, a present mpv/native probe is skipped (fall through).
   */
  createMpv?: () => AudioBackend;
  createNative?: () => AudioBackend;
  createFake?: () => AudioBackend;
  createSidecar?: () => AudioBackend;
  /** Injectible presence checks (unit tests). */
  isMpvPresent?: (env: NodeJS.ProcessEnv) => boolean;
  isNativePresent?: (env: NodeJS.ProcessEnv, platform: NodeJS.Platform) => boolean;
  isSidecarPresent?: () => boolean | Promise<boolean>;
  isFakePresent?: (env: NodeJS.ProcessEnv) => boolean;
};

export type SelectedAudioBackend = {
  backend: AudioBackend;
  capabilities: BackendCapabilities;
  /** Cached for the daemon lifetime (PC-302). */
  probes: BackendProbe[];
};

/** True when `name` resolves on PATH (detection only — never used by hook commands). */
export function isOnPath(name: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const pathEnv = env.PATH ?? env.Path ?? "";
  const exts =
    process.platform === "win32"
      ? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").filter(Boolean)
      : [""];
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = join(dir, `${name}${ext}`);
      try {
        accessSync(candidate, constants.F_OK);
        return true;
      } catch {
        // continue
      }
    }
  }
  return false;
}

export function detectMpvPresent(env: NodeJS.ProcessEnv = process.env): boolean {
  return isOnPath("mpv", env);
}

export function detectNativePresent(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform === "darwin") return isOnPath("afplay", env);
  if (platform === "win32") {
    return isOnPath("powershell", env) || isOnPath("pwsh", env);
  }
  return isOnPath("paplay", env) || isOnPath("aplay", env);
}

function nativeCaps(platform: NodeJS.Platform): BackendCapabilities {
  const name =
    platform === "darwin" ? "afplay" : platform === "win32" ? "powershell" : "paplay/aplay";
  return {
    available: true,
    tier: "native",
    name,
    loop: false, // respawn/seamed — honest for doctor
    fade: false,
    runtimeVolume: false,
  };
}

/**
 * Ordered backend detection (PC-302 / §11.3):
 * fake (env) → tier-1 sidecar → mpv → tier-3 native → none.
 *
 * Result is intended to be cached for the daemon process lifetime.
 */
export async function selectAudioBackend(
  options: SelectAudioBackendOptions = {},
): Promise<SelectedAudioBackend> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const probes: BackendProbe[] = [];

  // 1. Fake
  const fakePresent = (options.isFakePresent ?? isFakeAudioEnabled)(env);
  probes.push({ tier: "fake", name: "fake", present: fakePresent });
  if (fakePresent) {
    const backend = options.createFake?.() ?? FakeAudioBackend.fromEnv(env);
    const capabilities = await backend.detect();
    return { backend, capabilities, probes };
  }

  // 2. Sidecar
  const sidecarBackend =
    options.createSidecar?.() ?? new SidecarAudioBackend({ env, platform, arch });
  const sidecarCaps = await sidecarBackend.detect();
  const sidecarPresent = options.isSidecarPresent
    ? await options.isSidecarPresent()
    : sidecarCaps.available;
  probes.push({ tier: "sidecar", name: "sidecar", present: sidecarPresent });
  if (sidecarPresent && sidecarCaps.available) {
    return { backend: sidecarBackend, capabilities: sidecarCaps, probes };
  }

  // 3. mpv (adapter factory required — PC-303)
  const mpvPresent = (options.isMpvPresent ?? detectMpvPresent)(env);
  probes.push({ tier: "mpv", name: "mpv", present: mpvPresent });
  if (mpvPresent && options.createMpv) {
    const backend = options.createMpv();
    const capabilities = await backend.detect();
    if (capabilities.available) {
      return { backend, capabilities, probes };
    }
  }

  // 4. Native (adapter factory required — PC-304)
  const nativePresent = (options.isNativePresent ?? detectNativePresent)(env, platform);
  const nCaps = nativeCaps(platform);
  probes.push({ tier: "native", name: nCaps.name, present: nativePresent });
  if (nativePresent && options.createNative) {
    const backend = options.createNative();
    const capabilities = await backend.detect();
    if (capabilities.available) {
      return { backend, capabilities, probes };
    }
  }

  // 5. None
  const backend = new NoneAudioBackend();
  const capabilities = await backend.detect();
  probes.push({ tier: "none", name: "none", present: true });
  return { backend, capabilities, probes };
}
