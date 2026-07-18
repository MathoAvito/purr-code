#!/usr/bin/env bash
# Drive the sidecar PoC through the full control protocol on the null backend.
set -euo pipefail
cd "$(dirname "$0")"
BIN="${1:-./purr-sidecar-min}"

python3 - <<'EOF'
import struct, math, wave
sr = 48000
frames = bytearray()
for i in range(sr):
    v = 0.4 * math.sin(2 * math.pi * 220 * i / sr) * (0.6 + 0.4 * math.sin(2 * math.pi * 25 * i / sr))
    s = int(v * 32767)
    frames += struct.pack("<hh", s, s)
w = wave.open("test-purr.wav", "wb")
w.setnchannels(2); w.setsampwidth(2); w.setframerate(sr)
w.writeframes(bytes(frames)); w.close()
EOF

{
  echo "LOAD test-purr.wav"
  echo "PLAY"
  sleep 3
  echo "STATS"
  echo "VOLUME 50"
  sleep 1
  echo "STATS"
  echo "FADEOUT 400"
} | "$BIN" --null
