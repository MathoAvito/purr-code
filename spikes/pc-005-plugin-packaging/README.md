# PC-005 spike — plugin packaging validation

Throwaway plugin + local marketplace and evidence for PC-005. Findings and
decisions live in
[docs/decisions/0005-plugin-packaging.md](../../docs/decisions/0005-plugin-packaging.md).

Tested: Claude Code v2.1.197, Linux. macOS/Windows were **not** available —
flagged for PC-009 (this harness reruns anywhere Claude Code installs).

## Layout

- `marketplace/` — a minimal local marketplace (`.claude-plugin/marketplace.json`)
  containing one plugin, `plugins/purrcode-spike/`:
  - `.claude-plugin/plugin.json` (name + version)
  - `hooks/hooks.json` — exec-form hooks (`command: "node"`,
    `args: ["${CLAUDE_PLUGIN_ROOT}/hook.cjs", …]`, `async: true`) for
    `UserPromptSubmit` / `Stop` / `SessionEnd`
  - `hook.cjs` — logs event + all `CLAUDE_*` env to `/tmp/pc005-hook-events.jsonl`
    and writes a persistence marker into `$CLAUDE_PLUGIN_DATA`
- `evidence/hook-events.jsonl` — captured run log (install → update →
  disable → enable)

## Verified flow (all on v2.1.197)

```bash
claude plugin marketplace add ./marketplace          # local path marketplace
claude plugin install purrcode-spike@purrcode-spike-marketplace   # scope: user
# hooks fire; CLAUDE_PLUGIN_ROOT + CLAUDE_PLUGIN_DATA both set
claude plugin update purrcode-spike@purrcode-spike-marketplace    # 0.0.1 -> 0.0.2
# marker in $CLAUDE_PLUGIN_DATA survived (writes kept counting, firstWrittenAt unchanged)
claude plugin disable purrcode-spike@purrcode-spike-marketplace   # zero hook events fire
claude plugin enable purrcode-spike@purrcode-spike-marketplace    # events resume
claude plugin uninstall purrcode-spike@purrcode-spike-marketplace # data dir REMOVED by default
```

Notable details:

- `CLAUDE_PLUGIN_DATA` = `~/.claude/plugins/data/<plugin>-<marketplace>/` —
  exists and persists across updates, but **`uninstall` deletes it unless
  `--keep-data` is passed**.
- `plugin update` requires the full `name@marketplace` id; bare names fail.
- Update needs `claude plugin marketplace update <name>` first for
  path-sourced marketplaces.
- `claude plugin validate <path>` exists for CI linting of the manifest.
- Interesting: in this run the *async* `Stop` hook fired in `-p` mode
  (plugin-sourced), unlike the settings.json runs in ADR 0001 — treat `Stop`
  in headless mode as best-effort either way.
