# @purrcode/sidecar — tier-1 player sources (PC-301)

Production miniaudio sidecar (ADR 0004). Vendored headers are **not** committed
(~4 MB); fetch them before building:

```bash
pnpm --filter @purrcode/sidecar fetch-vendor
pnpm --filter @purrcode/sidecar build
# or: bash packages/sidecar/scripts/build.sh
```

The build writes `purr-sidecar` (+ `SHA256SUMS`) into the matching
`packages/sidecar-<os>-<cpu>/` package for local use and CI artifact packaging.

## Protocol

Newline-delimited JSON on **stdin**; JSON events on **stdout**.

| Command | Example |
| --- | --- |
| load | `{"cmd":"load","path":"/abs/sleepy.ogg"}` |
| volume | `{"cmd":"volume","amplitude":0.0316,"rampMs":100}` |
| play | `{"cmd":"play","fadeInMs":500}` |
| fadeout | `{"cmd":"fadeout","ms":400}` |
| quit | `{"cmd":"quit"}` |

`amplitude` is linear `[0,1]` — the Node `SidecarAudioBackend` applies the
PC-205 perceptual→amplitude map. Use `--null` for hardware-free runs.

## OGG

Vorbis via vendored `stb_vorbis` (same pin as miniaudio). WAV remains supported
for the FR-08 cache path.
