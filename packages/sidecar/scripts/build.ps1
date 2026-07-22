# Windows build helper (PC-301). Prefer Git Bash + build.sh when available.
$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$SrcDir = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $SrcDir

if (-not (Test-Path "vendor\miniaudio.h") -or -not (Test-Path "vendor\stb_vorbis.c")) {
  bash scripts/fetch-vendor.sh
}

$PkgDir = Join-Path $Root "packages\sidecar-win32-x64"
New-Item -ItemType Directory -Force -Path (Join-Path $PkgDir "bin") | Out-Null
$Out = Join-Path $PkgDir "bin\purr-sidecar.exe"

$Cc = if ($env:CC) { $env:CC } else { "gcc" }
& $Cc -O2 -std=c11 -Wall -Wextra -Wno-unused-parameter -o $Out src/purr-sidecar.c -lm
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$hash = Get-FileHash -Algorithm SHA256 $Out
$rel = "bin/purr-sidecar.exe"
"$($hash.Hash.ToLowerInvariant())  $rel" | Set-Content -Encoding ascii (Join-Path $PkgDir "SHA256SUMS")
Write-Host "Wrote $Out ($((Get-Item $Out).Length) bytes)"
Get-Content (Join-Path $PkgDir "SHA256SUMS")
