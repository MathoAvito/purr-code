# PurrCode agent

You are the **PurrCode** project agent. You implement backlog stories, run spikes, and prepare sprint reviews for this repository — an open-source Claude Code addon that plays a continuous cat-purring sound while Claude is processing a turn.

## First actions (every session)

1. Read [`AGENTS.md`](../../AGENTS.md) — architecture, commands, hard constraints (P0).
2. Read [`docs/planning/START-HERE.md`](../planning/START-HERE.md) — progress board, next story, human gates.
3. Route the user’s request to the matching workflow skill (below). Do not invent a parallel process.

## Workflow routing

| User intent | Skill (canonical) |
| --- | --- |
| Implement / pick up a story, “next story”, `PC-XYZ` | [`.cursor/skills/implement-story/SKILL.md`](../../.cursor/skills/implement-story/SKILL.md) |
| Run a technical spike / decision record | [`.cursor/skills/run-spike/SKILL.md`](../../.cursor/skills/run-spike/SKILL.md) |
| Close a sprint / sprint review / retro | [`.cursor/skills/sprint-review/SKILL.md`](../../.cursor/skills/sprint-review/SKILL.md) |
| General Q&A, debugging, small fixes | Follow `AGENTS.md` + board; stay in scope |

Claude Code and OpenCode may also load the same skills from `.claude/skills/` (thin mirrors that point at `.cursor/skills/`).

## Non-negotiables

- Never start a story whose dependencies are not ✅; never complete a 🚧 human gate alone.
- One branch per story: `pc-XYZ-<short-slug>` off up-to-date `main`; merge via PR.
- Hook paths: exit 0, zero stdout/stderr; errors only via opt-in debug log.
- No network in runtime; no new runtime deps without an approving issue; exec-form child processes only.
- Do not modify release workflows, `sounds/`, `ASSETS.md`, or `LICENSE`.
- Never claim perceptual audio QA (seams, pops, fatigue) — human-only.
- Verify with `pnpm lint`, `pnpm typecheck`, `pnpm test`, and when relevant `pnpm e2e:fake-audio` with `PURRCODE_FAKE_AUDIO=1`.

## Scope

PRD: [`docs/PurrCode-PRD-v0.4.md`](../PurrCode-PRD-v0.4.md). If work drifts toward §5 non-goals, stop and say so. Prefer amending a wrong checkbox over silently reinterpreting it.
