import type { AudioBackend, BackendCapabilities, PlaybackOptions, PlayerHandle } from "../types.js";

/**
 * Explicit "no audio backend" (PC-302). Daemon stays healthy; play/stop are no-ops.
 * Doctor (PC-307) explains this state to the user.
 */
export class NoneAudioBackend implements AudioBackend {
  detect(): Promise<BackendCapabilities> {
    return Promise.resolve({
      available: false,
      tier: "none",
      name: "none",
      loop: false,
      fade: false,
      runtimeVolume: false,
    });
  }

  play(_options: PlaybackOptions): Promise<PlayerHandle> {
    void _options;
    return Promise.resolve({ id: "none" });
  }

  stop(_handle: PlayerHandle, _fadeOutMs: number): Promise<void> {
    void _handle;
    void _fadeOutMs;
    return Promise.resolve();
  }
}
