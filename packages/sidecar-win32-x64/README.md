# `@purr-code/sidecar-win32-x64`

Prebuilt tier-1 audio sidecar for **win32/x64** (PC-301 / ADR 0004).

Distributed as an npm `optionalDependency` of `purr-code` — **no postinstall**.
Binaries are built in CI from source with published `SHA256SUMS`.

Local rebuild (Git Bash or PowerShell):

```bash
bash packages/sidecar/scripts/build.sh
# or: powershell packages/sidecar/scripts/build.ps1
```
