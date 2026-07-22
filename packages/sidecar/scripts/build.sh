#!/usr/bin/env bash
# Build the tier-1 sidecar for the host (or TARGET_OS/TARGET_ARCH overrides).
# Writes the binary + SHA256SUMS into packages/sidecar-<os>-<cpu>/bin/.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SRC_DIR"

if [[ ! -f vendor/miniaudio.h || ! -f vendor/stb_vorbis.c ]]; then
  bash scripts/fetch-vendor.sh
fi

HOST_OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
HOST_ARCH="$(uname -m)"
case "$HOST_ARCH" in
  x86_64|amd64) HOST_ARCH=x64 ;;
  aarch64|arm64) HOST_ARCH=arm64 ;;
esac

TARGET_OS="${TARGET_OS:-}"
TARGET_ARCH="${TARGET_ARCH:-}"
if [[ -z "$TARGET_OS" ]]; then
  case "$HOST_OS" in
    linux*) TARGET_OS=linux ;;
    darwin*) TARGET_OS=darwin ;;
    msys*|mingw*|cygwin*) TARGET_OS=win32 ;;
    *) echo "Unsupported host OS: $HOST_OS" >&2; exit 1 ;;
  esac
fi
if [[ -z "$TARGET_ARCH" ]]; then
  TARGET_ARCH="$HOST_ARCH"
fi

OUT_NAME="purr-sidecar"
EXT=""
if [[ "$TARGET_OS" == "win32" ]]; then
  EXT=".exe"
fi

PKG_DIR="$ROOT/packages/sidecar-${TARGET_OS}-${TARGET_ARCH}"
if [[ ! -d "$PKG_DIR" ]]; then
  echo "Missing platform package dir: $PKG_DIR" >&2
  exit 1
fi
mkdir -p "$PKG_DIR/bin"
OUT="$PKG_DIR/bin/${OUT_NAME}${EXT}"

CC="${CC:-cc}"
CFLAGS=(-O2 -std=c11 -Wall -Wextra -Wno-unused-parameter)
LDFLAGS=()
ARCH_FLAGS=()

case "$TARGET_OS" in
  linux)
    LDFLAGS+=(-lm -lpthread -ldl)
    ;;
  darwin)
    LDFLAGS+=(-lm -lpthread)
    if [[ "$TARGET_ARCH" == "arm64" ]]; then
      ARCH_FLAGS+=(-arch arm64)
    elif [[ "$TARGET_ARCH" == "x64" ]]; then
      ARCH_FLAGS+=(-arch x86_64)
    fi
    ;;
  win32)
    # Expects a unixy toolchain (CI windows-latest uses gcc from GitHub runner /
    # or cl via build.ps1). Plain gcc/MinGW:
    LDFLAGS+=(-lm)
    ;;
  *)
    echo "Unsupported TARGET_OS=$TARGET_OS" >&2
    exit 1
    ;;
esac

echo "Building $OUT (os=$TARGET_OS arch=$TARGET_ARCH cc=$CC)"
"$CC" "${CFLAGS[@]}" "${ARCH_FLAGS[@]}" -o "$OUT" src/purr-sidecar.c "${LDFLAGS[@]}"

# Strip when available (ignore failure on exotic toolchains).
if command -v strip >/dev/null 2>&1 && [[ "$TARGET_OS" != "win32" ]]; then
  strip "$OUT" || true
fi

SIZE="$(wc -c < "$OUT" | tr -d ' ')"
echo "Binary size: $SIZE bytes"

# Soft budget: "a few hundred KB" — warn above 900 KB (stb_vorbis ~+100–200 KB).
if [[ "$SIZE" -gt 900000 ]]; then
  echo "WARNING: sidecar larger than 900 KB budget ($SIZE)" >&2
fi

SUMS="$PKG_DIR/SHA256SUMS"
(
  cd "$PKG_DIR"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "bin/${OUT_NAME}${EXT}" > SHA256SUMS
  else
    shasum -a 256 "bin/${OUT_NAME}${EXT}" > SHA256SUMS
  fi
)
echo "Wrote $SUMS"
cat "$SUMS"
echo "OK"
