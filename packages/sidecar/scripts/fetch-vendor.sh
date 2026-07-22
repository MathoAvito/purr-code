#!/usr/bin/env bash
# Fetch pinned miniaudio + stb_vorbis (not committed — ~4 MB header).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p vendor

MINIAUDIO_TAG="${MINIAUDIO_TAG:-0.11.25}"
BASE="https://raw.githubusercontent.com/mackron/miniaudio/${MINIAUDIO_TAG}"

curl -fsSL -o vendor/miniaudio.h "${BASE}/miniaudio.h"
curl -fsSL -o vendor/stb_vorbis.c "${BASE}/extras/stb_vorbis.c"

grep -m1 -o 'miniaudio - v[0-9.]*' vendor/miniaudio.h
head -n1 vendor/stb_vorbis.c
echo "Pinned miniaudio ${MINIAUDIO_TAG} → vendor/"
