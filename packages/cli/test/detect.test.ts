import { describe, expect, it } from "vitest";

import { detectMpvPresent, detectNativePresent, selectAudioBackend } from "../src/audio/detect.js";
import type {
  AudioBackend,
  BackendCapabilities,
  PlaybackOptions,
  PlayerHandle,
} from "../src/audio/types.js";
import { NoneAudioBackend } from "../src/audio/none/NoneAudioBackend.js";

function stubBackend(caps: BackendCapabilities): AudioBackend {
  return {
    detect: () => Promise.resolve(caps),
    play: (_o: PlaybackOptions): Promise<PlayerHandle> => {
      void _o;
      return Promise.resolve({ id: caps.tier });
    },
    stop: () => Promise.resolve(),
  };
}

describe("backend detection (PC-302)", () => {
  it("prefers fake when PURRCODE_FAKE_AUDIO is set", async () => {
    const selected = await selectAudioBackend({
      env: { PURRCODE_FAKE_AUDIO: "1" },
      isSidecarPresent: () => true,
      isMpvPresent: () => true,
      isNativePresent: () => true,
      createMpv: () =>
        stubBackend({
          available: true,
          tier: "mpv",
          name: "mpv",
          loop: true,
          fade: true,
          runtimeVolume: true,
        }),
      createNative: () =>
        stubBackend({
          available: true,
          tier: "native",
          name: "afplay",
          loop: false,
          fade: false,
          runtimeVolume: false,
        }),
    });
    expect(selected.capabilities.tier).toBe("fake");
    expect(selected.capabilities.available).toBe(true);
    expect(selected.probes[0]).toMatchObject({ tier: "fake", present: true });
  });

  it("selects sidecar when fake is off and sidecar is present", async () => {
    const selected = await selectAudioBackend({
      env: {},
      isFakePresent: () => false,
      isSidecarPresent: () => true,
      createSidecar: () =>
        stubBackend({
          available: true,
          tier: "sidecar",
          name: "sidecar",
          loop: true,
          fade: true,
          runtimeVolume: true,
        }),
      isMpvPresent: () => true,
      createMpv: () =>
        stubBackend({
          available: true,
          tier: "mpv",
          name: "mpv",
          loop: true,
          fade: true,
          runtimeVolume: true,
        }),
    });
    expect(selected.capabilities.tier).toBe("sidecar");
  });

  it("falls through to mpv when sidecar absent and factory provided", async () => {
    const selected = await selectAudioBackend({
      env: {},
      isFakePresent: () => false,
      isSidecarPresent: () => false,
      isMpvPresent: () => true,
      createMpv: () =>
        stubBackend({
          available: true,
          tier: "mpv",
          name: "mpv",
          loop: true,
          fade: true,
          runtimeVolume: true,
        }),
      isNativePresent: () => true,
    });
    expect(selected.capabilities.tier).toBe("mpv");
    expect(selected.probes.map((p) => p.tier)).toEqual(["fake", "sidecar", "mpv"]);
  });

  it("falls through to native when mpv absent and factory provided", async () => {
    const selected = await selectAudioBackend({
      env: {},
      platform: "darwin",
      isFakePresent: () => false,
      isSidecarPresent: () => false,
      isMpvPresent: () => false,
      isNativePresent: () => true,
      createNative: () =>
        stubBackend({
          available: true,
          tier: "native",
          name: "afplay",
          loop: false,
          fade: false,
          runtimeVolume: false,
        }),
    });
    expect(selected.capabilities).toMatchObject({
      tier: "native",
      available: true,
      fade: false,
      runtimeVolume: false,
    });
  });

  it("selects none when nothing is available (daemon-safe)", async () => {
    const selected = await selectAudioBackend({
      env: {},
      isFakePresent: () => false,
      isSidecarPresent: () => false,
      isMpvPresent: () => false,
      isNativePresent: () => false,
    });
    expect(selected.backend).toBeInstanceOf(NoneAudioBackend);
    expect(selected.capabilities).toEqual({
      available: false,
      tier: "none",
      name: "none",
      loop: false,
      fade: false,
      runtimeVolume: false,
    });
    // Present mpv without a factory must not be selected (PC-303 owns the adapter).
    const skippedMpv = await selectAudioBackend({
      env: {},
      isFakePresent: () => false,
      isSidecarPresent: () => false,
      isMpvPresent: () => true,
      isNativePresent: () => false,
    });
    expect(skippedMpv.capabilities.tier).toBe("none");
    expect(skippedMpv.probes.find((p) => p.tier === "mpv")?.present).toBe(true);
  });

  it("PATH probes for mpv / native are boolean", () => {
    expect(typeof detectMpvPresent({ PATH: "/no/such/bin" })).toBe("boolean");
    expect(typeof detectNativePresent({ PATH: "/no/such/bin" }, "linux")).toBe("boolean");
  });
});
