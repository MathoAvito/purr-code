# `@purrcode/plugin` — Claude Code plugin package (PC-401)

Assembled Claude Code plugin + local marketplace for PurrCode.

## Layout

```
marketplace/
  .claude-plugin/marketplace.json
  plugins/purrcode/
    .claude-plugin/plugin.json
    hooks/hooks.json          # PRD §15 exec form (all four events)
    dist/                     # assembled from packages/cli/dist
    sounds/sleepy.{ogg,wav}   # bundled asset + sleepy.license.json
    vendor/sidecar/           # host-platform binary when built (optional)
```

Persistent state (config, WAV cache) lives in `${CLAUDE_PLUGIN_DATA}` at runtime — not in this tree.

## Build

```bash
pnpm --filter purr-code build
pnpm --filter @purrcode/plugin assemble
pnpm --filter @purrcode/plugin validate
# or:
pnpm plugin:build
```

## Install (dev / local marketplace)

```bash
claude plugin marketplace add ./packages/plugin/marketplace
claude plugin install purrcode@purrcode
```

Production front door is `npx purr-code install` (PC-402).

## Constraints

- Hooks are **exec form only** (`command: "node"`, `args` with `${CLAUDE_PLUGIN_ROOT}/dist/hook.js`).
- Never string-form, never `npx` on the hook path.
- `async: true`, `timeout: 5`, no `matcher` fields.
