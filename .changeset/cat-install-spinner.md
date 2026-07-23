---
"purr-code": minor
---

`purrcode install` now shows a cat-chasing-yarn spinner during the long steps (copying plugin files, installing sounds, verifying audio playback). The animation only runs on an interactive terminal — it is disabled in CI, when output is piped, and under `NO_COLOR` — and it never keeps the process alive.
