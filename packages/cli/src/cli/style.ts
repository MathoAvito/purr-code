/** Minimal CLI styling that respects NO_COLOR (PC-306 / §16). */

export function colorEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
  if (env.FORCE_COLOR === "0") return false;
  return Boolean(process.stdout.isTTY);
}

export function paint(text: string, code: string, env: NodeJS.ProcessEnv = process.env): string {
  if (!colorEnabled(env)) return text;
  return `\u001b[${code}m${text}\u001b[0m`;
}

export const style = {
  ok: (s: string, env?: NodeJS.ProcessEnv) => paint(s, "32", env),
  warn: (s: string, env?: NodeJS.ProcessEnv) => paint(s, "33", env),
  err: (s: string, env?: NodeJS.ProcessEnv) => paint(s, "31", env),
  dim: (s: string, env?: NodeJS.ProcessEnv) => paint(s, "2", env),
  bold: (s: string, env?: NodeJS.ProcessEnv) => paint(s, "1", env),
};
