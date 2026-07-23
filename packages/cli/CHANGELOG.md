# purr-code

## 0.2.1

### Patch Changes

- dce6752: Fix: bundled/npm sidecar binary shipped without the POSIX execute bit (GitHub Actions artifacts strip permissions), so on Linux/macOS audio silently fell back to the degraded `aplay` backend (no loop, no fade). `isExecutableFile` now self-heals by adding +x when a readable-but-non-executable binary is found; the plugin assemble step and release workflow also set mode 755 explicitly.

## 0.2.0

### Minor Changes

- 8b8d3d4: Default volume raised 20 → 60. `purrcode install` now tells you to restart Claude Code so the hooks load, and when run via `npx` it prints `npx purr-code …` follow-up commands (npx puts no `purrcode` on PATH) plus a global-install tip. READMEs now lead with `npm install -g purr-code`.

## 0.1.0

### Minor Changes

- 45996d5: `purrcode install` now shows a cat-chasing-yarn spinner during the long steps (copying plugin files, installing sounds, verifying audio playback). The animation only runs on an interactive terminal — it is disabled in CI, when output is piped, and under `NO_COLOR` — and it never keeps the process alive.
- 66c6a45: Sidecar packages are scoped `@purr-code/*` (matching the CLI package name and the npm org). The previously planned `@purrcode` scope was unavailable at org registration; nothing was ever published under it.
- e6a9f94: Plugin package, install/uninstall CLI, OSS community surface, and release pipeline prep (Sprint 4).
