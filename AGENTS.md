# AGENTS.md — canonical agent context for PurrCode

This is the single source of truth for AI coding agents (Claude Code, Cursor, OpenCode, Codex, and similar) working in this repository. `CLAUDE.md` points here; do not duplicate hard constraints into per-tool files.

## What this project is

PurrCode is an open-source Claude Code addon that plays a continuous cat-purring sound while Claude is processing a turn. Architecture: **hook adapter** (transient, invisible) → **per-user player daemon** (session registry, watchdog, playback state machine) → **tiered audio backends** (bundled sidecar / mpv / native players / fake). Full spec: [docs/PurrCode-PRD-v0.4.md](docs/PurrCode-PRD-v0.4.md) — the PRD is the roadmap; amendments to it are PRs.

## Current state & how to pick work

The project is being built sprint-by-sprint from a written backlog. **Before doing anything, read [docs/planning/START-HERE.md](docs/planning/START-HERE.md)** — it has the progress board, dependency order, and the per-story workflow. Never start a story whose dependencies aren't done, and never cross a 🚧 human gate.

- Sprint plan and working agreements: `docs/planning/00-sprint-plan.md`
- Story details: `docs/planning/sprint-N-*.md` (acceptance checkboxes are the definition of done)
- Spike/architecture decisions: `docs/decisions/` (use `TEMPLATE.md`)

## Invoking the PurrCode agent

The callable project agent is **`purrcode`**. Canonical prompt: [docs/agents/purrcode.md](docs/agents/purrcode.md). Tool wrappers (frontmatter only) live at:

| Tool | Invoke | Wrapper |
| --- | --- | --- |
| **Cursor** | `/purrcode` or Task → purrcode | [`.cursor/agents/purrcode.md`](.cursor/agents/purrcode.md) |
| **Claude Code** | `@purrcode` or ask to use the purrcode agent | [`.claude/agents/purrcode.md`](.claude/agents/purrcode.md) |
| **OpenCode** | Tab to `purrcode`, or `@purrcode` | [`.opencode/agents/purrcode.md`](.opencode/agents/purrcode.md) |

Workflow skills (implement story / spike / sprint review) live under [`.cursor/skills/`](.cursor/skills/); Claude mirrors under [`.claude/skills/`](.claude/skills/) point at those files. OpenCode loads `AGENTS.md` plus [opencode.json](opencode.json) instructions.

## Commands

```bash
pnpm install                 # setup (Node 20+, pnpm workspace)
pnpm lint                    # ESLint + Prettier check
pnpm typecheck               # tsc --noEmit, strict
pnpm test                    # Vitest unit tests
pnpm e2e:fake-audio          # integration suite against the fake audio backend
pnpm sidecar:fetch-vendor    # pin miniaudio + stb_vorbis into packages/sidecar/vendor/
pnpm sidecar:build           # build host-platform purr-sidecar into packages/sidecar-<os>-<cpu>/
pnpm e2e:sidecar             # real sidecar lifecycle (needs a built binary; skipped if absent)
pnpm plugin:build            # assemble + validate Claude Code plugin (packages/plugin/)
```

MVP CLI (after `pnpm --filter purr-code build`): `purrcode on|off`, `status`, `volume`, `preview`, `doctor`. Ops notes: [docs/troubleshooting.md](docs/troubleshooting.md).

## Verifying changes headlessly

Set `PURRCODE_FAKE_AUDIO=1` to use the fake audio backend (story PC-101): it implements the `AudioBackend` interface by writing timestamped playback events (start/volume/fade/stop) to a JSONL log instead of a sound card. All loop/fade/refcount/watchdog logic must be verifiable this way — no speakers, no audio hardware, deterministic in CI. Perceptual audio QA (seams, pops, fatigue) is human-only; never claim to have verified it.

## Hard constraints (violations are P0)

1. **Fail silent, fail open.** Hook-path code must always exit 0 and never write a byte to stdout/stderr — a single transcript error notice in Claude Code is a critical bug. Errors go to the opt-in debug log only.
2. **No network code anywhere.** Runtime makes zero network requests. No telemetry, no analytics, no update checks.
3. **No new runtime dependencies** without a linked issue approving them. Dev dependencies need a reason in the PR.
4. **All child processes in exec form** (argument arrays). Never shell-interpolated strings, never `eval`, never `npx` in anything a hook executes.
5. **Treat hook stdin as untrusted:** schema-validate, size-cap, never interpolate its fields into shell commands or paths.
6. **Never modify** release workflows (`.github/workflows/` publish/release files), `sounds/` audio assets, or licensing files (`ASSETS.md`, `LICENSE`) — human-gated per CODEOWNERS. Audio provenance/credits live in [`ASSETS.md`](ASSETS.md).
7. **No prompt/transcript access.** Never read, store, or log prompt text, responses, tool inputs, or repository contents in runtime code or logs.
8. Agents may not contribute audio assets and may not sign the DCO on a human's behalf. (Humans may instruct an agent to *place* an already-sourced, license-verified file the human provides — still update `ASSETS.md` in the same commit.)

## Conventions

- **One branch per sprint.** Each sprint gets a single branch off `main`, named `sprint-N-<short-slug>` (e.g. `sprint-1-walking-skeleton`, `sprint-2-reliability`). All stories in that sprint land on that branch; merge via one PR when the sprint is ready. Never commit sprint work directly to `main`. Commits still reference the story ID (e.g. `feat(daemon): session registry state machine (PC-105)`).
- TypeScript strict, Node 20+, pnpm. Conventional-commit style messages referencing the story ID.
- When a story is complete: tick its checkboxes in the sprint file and update the board in `START-HERE.md` in the same commit.
- Scope discipline: PRD §5 non-goals are enforced. If a change drifts toward them, stop and say so instead of building it.
