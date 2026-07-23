# purr-code

## 0.1.0

### Minor Changes

- 45996d5: `purrcode install` now shows a cat-chasing-yarn spinner during the long steps (copying plugin files, installing sounds, verifying audio playback). The animation only runs on an interactive terminal — it is disabled in CI, when output is piped, and under `NO_COLOR` — and it never keeps the process alive.
- 66c6a45: Sidecar packages are scoped `@purr-code/*` (matching the CLI package name and the npm org). The previously planned `@purrcode` scope was unavailable at org registration; nothing was ever published under it.
- e6a9f94: Plugin package, install/uninstall CLI, OSS community surface, and release pipeline prep (Sprint 4).
