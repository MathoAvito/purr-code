/**
 * Dependency-free cat spinner for long-running CLI steps (PC-306 / §16).
 *
 * Animates only on an interactive TTY; in CI, pipes, or under NO_COLOR it
 * degrades to plain line output so injected test streams and logs stay clean.
 * Never used on the hook path.
 */

const CAT = "🐈";
const YARN = "🧶";
const TRACK_WIDTH = 8;
const FRAME_MS = 120;

export type CatSpinner = {
  /** Stop animating and clear the spinner line. Idempotent. */
  stop: () => void;
};

export type StartCatSpinnerOptions = {
  env?: NodeJS.ProcessEnv;
  /** Force-enable/disable regardless of TTY (tests). */
  enabled?: boolean;
  /** Output stream (defaults to process.stdout). */
  stream?: NodeJS.WriteStream;
  /** Injectable timers (tests). */
  setInterval?: typeof globalThis.setInterval;
  clearInterval?: typeof globalThis.clearInterval;
};

export function spinnerEnabled(
  env: NodeJS.ProcessEnv = process.env,
  stream: NodeJS.WriteStream = process.stdout,
): boolean {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
  if (env.CI !== undefined && env.CI !== "") return false;
  return Boolean(stream.isTTY);
}

/** Render one frame: the cat closes in on the yarn, then starts over. */
export function catFrame(tick: number, label: string): string {
  const pos = tick % TRACK_WIDTH;
  const gap = TRACK_WIDTH - 1 - pos;
  return `${" ".repeat(pos)}${CAT}${" ".repeat(gap)}${YARN} ${label}`;
}

export function startCatSpinner(label: string, options: StartCatSpinnerOptions = {}): CatSpinner {
  const env = options.env ?? process.env;
  const stream = options.stream ?? process.stdout;
  const enabled = options.enabled ?? spinnerEnabled(env, stream);
  if (!enabled) return { stop: () => {} };

  const set = options.setInterval ?? globalThis.setInterval;
  const clear = options.clearInterval ?? globalThis.clearInterval;

  let tick = 0;
  const draw = () => {
    stream.write(`\r\u001b[2K${catFrame(tick, label)}`);
    tick += 1;
  };
  draw();
  const timer = set(draw, FRAME_MS);
  // Never keep the process alive just for the animation.
  timer.unref?.();

  let stopped = false;
  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      clear(timer);
      stream.write("\r\u001b[2K");
    },
  };
}
