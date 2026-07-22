/**
 * Sidecar stdin/stdout protocol (PC-301 / ADR 0004 amendment).
 * Newline-delimited JSON both ways. Amplitude is linear [0,1].
 */

export type SidecarCommand =
  | { cmd: "load"; path: string }
  | { cmd: "play"; fadeInMs?: number }
  | { cmd: "volume"; amplitude: number; rampMs?: number }
  | { cmd: "fadeout"; ms: number }
  | { cmd: "quit" }
  | { cmd: "stats" };

export type SidecarProtocolEventName =
  | "ready"
  | "loaded"
  | "playing"
  | "volume"
  | "fadeout"
  | "stopped"
  | "stats"
  | "exiting"
  | "exported"
  | "error";

export type SidecarEvent = {
  t?: number;
  event: SidecarProtocolEventName;
  [key: string]: unknown;
};

export function encodeSidecarCommand(command: SidecarCommand): string {
  return `${JSON.stringify(command)}\n`;
}

export function parseSidecarEventLine(line: string): SidecarEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const value = JSON.parse(trimmed) as unknown;
    if (
      typeof value !== "object" ||
      value === null ||
      typeof (value as { event?: unknown }).event !== "string"
    ) {
      return null;
    }
    return value as SidecarEvent;
  } catch {
    return null;
  }
}
