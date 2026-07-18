#!/usr/bin/env bash
# Fetch the exact miniaudio version this spike tested (not committed: 4 MB).
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p vendor
curl -fsSL -o vendor/miniaudio.h \
  https://raw.githubusercontent.com/mackron/miniaudio/0.11.25/miniaudio.h
grep -m1 -o 'miniaudio - v[0-9.]*' vendor/miniaudio.h
