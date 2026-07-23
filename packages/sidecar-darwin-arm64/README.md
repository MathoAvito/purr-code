# `@purr-code/sidecar-darwin-arm64`

Prebuilt tier-1 audio sidecar for **darwin/arm64** (PC-301 / ADR 0004).

Distributed as an npm `optionalDependency` of `purr-code` — **no postinstall**.
Binaries are built in CI from source with published `SHA256SUMS`.

Local rebuild:

```bash
pnpm --filter @purrcode/sidecar build
```
