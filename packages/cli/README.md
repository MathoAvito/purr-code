# PurrCode

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

## CLI

| Command | Purpose |
| --- | --- |
| `purrcode install` / `uninstall` | Plugin register / clean removal |
| `purrcode on` / `off` | Enable or mute |
| `purrcode status` | Daemon + backend snapshot |
| `purrcode volume <0-100>` | Perceptual volume |
| `purrcode preview [name]` | ~10 s sample (no Claude session needed) |
| `purrcode doctor` | Diagnostics |

## Privacy

- **No network requests at runtime.** No telemetry, analytics, or update checks.
- **No prompt or transcript access.** Hooks never read, store, or log prompt text, responses, tool inputs, or repository contents.
- Failures are silent on the hook path (exit 0, zero stdout/stderr) so Claude's transcript stays clean.

## Docs, issues, contributing

Full documentation, troubleshooting, and contribution guides live in the
[GitHub repository](https://github.com/MathoAvito/purr-code).

## License

[MIT](https://github.com/MathoAvito/purr-code/blob/main/LICENSE). Bundled audio provenance: [ASSETS.md](https://github.com/MathoAvito/purr-code/blob/main/ASSETS.md).
