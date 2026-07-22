# `@purrcode/sidecar-darwin-x64`

Prebuilt tier-1 audio sidecar for **darwin/x64** (PC-301 / ADR 0004).

Built on macOS CI with `-arch x86_64`. Distributed as an npm
`optionalDependency` of `purr-code` — **no postinstall**.

Local rebuild (on macOS):

```bash
TARGET_ARCH=x64 pnpm --filter @purrcode/sidecar build
```
