# 0005 — Plugin packaging: plugin-first path validated (Linux + macOS)

- **Status:** Accepted — Linux + macOS arm64 verified (2026-07-19); Windows outstanding
- **Date:** 2026-07-18 (macOS rerun 2026-07-19)
- **Story:** PC-005
- **macOS evidence:** [macos-rerun-20260719.md](../planning/reviews/macos-rerun-20260719.md) · `spikes/pc-005-plugin-packaging/evidence/macos-20260719/`
- **PRD refs:** FR-01 (plugin-first, never touch settings.json) / §14 (installer) / §15

## Question

Does the plugin path actually work — minimal plugin installs, hooks fire via
`${CLAUDE_PLUGIN_ROOT}` exec form, `${CLAUDE_PLUGIN_DATA}` persists across
updates, and enable/disable maps to `purrcode on|off`? What do local-install
vs marketplace flows look like for the installer (E7)?

## Evidence

Claude Code v2.1.197, Linux. A real plugin + local marketplace, installed,
updated, disabled, enabled, and uninstalled through the `claude plugin` CLI;
harness and captured events in
[`spikes/pc-005-plugin-packaging/`](../../spikes/pc-005-plugin-packaging/README.md).
**macOS arm64 verified 2026-07-19:** install/update/disable/enable; data dir
persists across update (`firstWrittenAt` stable). **Windows still unpaid.**

1. **Install + hooks fire.** `claude plugin marketplace add <local path>` then
   `claude plugin install purrcode-spike@purrcode-spike-marketplace` (default
   scope: user). Exec-form hooks with `${CLAUDE_PLUGIN_ROOT}` in `args`
   resolved and fired; the hook received both `CLAUDE_PLUGIN_ROOT` (plugin
   dir) and `CLAUDE_PLUGIN_DATA`
   (`~/.claude/plugins/data/<plugin>-<marketplace>/`).
2. **Data persistence.** A marker written into `$CLAUDE_PLUGIN_DATA` before a
   version bump (0.0.1 → 0.0.2, `claude plugin update`) survived the update
   intact (write counter kept counting, first-write timestamp unchanged).
   **But `uninstall` deletes the data dir unless `--keep-data` is passed.**
3. **Enable/disable gates hooks completely.** With the plugin disabled, a full
   headless turn produced *zero* hook events; after re-enable, events resumed
   immediately. Both are one CLI command (`claude plugin disable|enable
   <name@marketplace>`).
4. **CLI quirks recorded:** `plugin update` requires the full
   `name@marketplace` id; path-sourced marketplaces need
   `claude plugin marketplace update` before `plugin update` sees the new
   version; `claude plugin validate <path>` lints manifests (useful for our
   CI); `claude plugin tag` exists for release tagging.
5. **Bonus observation:** the async `Stop` hook *did* fire in `-p` mode when
   plugin-sourced (it did not from `settings.json` in ADR 0001) — headless
   `Stop` should be treated as best-effort regardless; the ADR 0001 guidance
   (rely on `SessionEnd` + `CLAUDE_CODE_ENTRYPOINT`) stands.

## Decision

- **FR-01 is confirmed viable**: PurrCode ships as a plugin; `settings.json`
  is never touched on the default path. Hook config stays exactly as PRD §15
  (exec form, `${CLAUDE_PLUGIN_ROOT}`, `async: true`).
- **`purrcode on|off` maps to `claude plugin enable|disable`** semantics — no
  divergence needed. (Implementation detail for E7/PC-306: either shell out
  to the `claude` CLI or toggle the daemon-side mute; the plugin mechanism
  gives us the hard-off switch for free.)
- **Persistent state lives in `${CLAUDE_PLUGIN_DATA}`**, but because default
  uninstall deletes it, anything the user must not lose (custom sounds,
  config) belongs in PurrCode's own config dir; plugin-data holds only
  regenerable state. `purrcode uninstall` (PC-403) should mention
  `--keep-data`.
- **Installer flows (E7/PC-402), documented:**
  - *Marketplace path (default):* `claude plugin marketplace add
    <github-repo-or-url>` once, then `claude plugin install
    purrcode@<marketplace>`. Updates via `claude plugin update`.
  - *Local path (dev/offline):* `claude plugin marketplace add <local dir>` —
    identical semantics, live-sourced from the path.
  - The installer can drive both through the `claude plugin` CLI
    non-interactively; `claude plugin validate` runs in our CI to lint the
    manifest before release.

## Consequences

- Backlog impact (flag for PC-009):
  - PC-401 (plugin package): manifest shape proven; add `claude plugin
    validate` to CI.
  - PC-402 (installer): flows above; requires the full `name@marketplace` id
    for updates.
  - PC-403 (uninstall): default data deletion is user-facing — decide
    keep-data behavior explicitly.
  - PC-306 (`purrcode on|off`): plugin enable/disable is the mechanism.
- PRD impact: none — FR-01 assumptions confirmed.
- Follow-ups: Windows plugin path still unpaid.
