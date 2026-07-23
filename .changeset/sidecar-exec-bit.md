---
"purr-code": patch
---

Fix: bundled/npm sidecar binary shipped without the POSIX execute bit (GitHub Actions artifacts strip permissions), so on Linux/macOS audio silently fell back to the degraded `aplay` backend (no loop, no fade). `isExecutableFile` now self-heals by adding +x when a readable-but-non-executable binary is found; the plugin assemble step and release workflow also set mode 755 explicitly.
