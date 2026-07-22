# PurrCode

[![CI](https://github.com/MathoAvito/purr-code/actions/workflows/ci.yml/badge.svg)](https://github.com/MathoAvito/purr-code/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/purr-code.svg)](https://www.npmjs.com/package/purr-code)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/MathoAvito/purr-code/badge)](https://scorecard.dev/viewer/?uri=github.com/MathoAvito/purr-code)

> Claude works. Claude purrs.

PurrCode is an open-source [Claude Code](https://code.claude.com) addon that plays a continuous cat-purring sound while Claude is processing a turn. When you submit a prompt, the purr fades in; when the turn ends (or fails, or the session closes), it fades out.

## Install

Requires [Node.js 20+](https://nodejs.org/) and [Claude Code](https://code.claude.com) on your `PATH`.

```bash
npx purr-code install
# or: npm i -g purr-code && purrcode install
```

This registers PurrCode as a **Claude Code plugin**. Your `settings.json` hooks are never edited on the default path.

Then try:

```bash
purrcode preview
purrcode volume 15
```

## Uninstall

```bash
purrcode uninstall
# keep config/WAV cache:  purrcode uninstall --keep-data
```

## Architecture (sketch)

```text
Claude Code hook (async, exec form)
        │  start / stop / failure / session-end
        ▼
  hook adapter  ──►  per-user player daemon  ──►  audio backend
                     (session registry,               │
                      watchdog, fades)                ▼
                                          tier 1: bundled sidecar
                                          tier 2: mpv
                                          tier 3: native OS player
```

Persistent state (config, WAV cache) lives under Claude’s `${CLAUDE_PLUGIN_DATA}` so plugin updates do not wipe it.

## Privacy

- **No network requests at runtime.** No telemetry, analytics, or update checks.
- **No prompt or transcript access.** Hooks never read, store, or log prompt text, responses, tool inputs, or repository contents.
- Failures are silent on the hook path (exit 0, zero stdout/stderr) so Claude’s transcript stays clean.

## Troubleshooting

If the cat is silent:

1. Run `purrcode doctor` — every failed check includes a concrete fix.
2. Default volume is **20** (very quiet). Try `purrcode volume 50`.
3. Prefer the bundled sidecar (tier 1); `mpv` is a good fallback.

More detail: [docs/troubleshooting.md](docs/troubleshooting.md).

## CLI

| Command | Purpose |
| --- | --- |
| `purrcode install` / `uninstall` | Plugin register / clean removal |
| `purrcode on` / `off` | Enable or mute |
| `purrcode status` | Daemon + backend snapshot |
| `purrcode volume <0-100>` | Perceptual volume |
| `purrcode preview [name]` | ~10 s sample (no Claude session needed) |
| `purrcode doctor` | Diagnostics |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) (dev setup, DCO, AI-assisted policy) and [AGENTS.md](AGENTS.md) for agent contributors. Scope is intentionally narrow — non-goals live in the [PRD §5](docs/PurrCode-PRD-v0.4.md).

## License

[MIT](LICENSE). Bundled audio provenance: [ASSETS.md](ASSETS.md).

If this project is abandoned, the repo will be archived rather than left ambiguous.
