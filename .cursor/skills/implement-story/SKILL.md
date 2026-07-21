---
name: implement-story
description: Implement a PurrCode backlog story (PC-XYZ) end to end following the project workflow. Use when the user asks to implement, work on, or pick up a story, says "next story", or references a PC- story ID.
---

# Implement a backlog story

## Workflow

Copy this checklist and track progress:

```
- [ ] 1. Locate & qualify the story
- [ ] 2. Read the context
- [ ] 3. Mark in progress
- [ ] 4. Implement to the checkboxes
- [ ] 5. Verify
- [ ] 6. Close out
```

**1. Locate & qualify.** Find the story in `docs/planning/sprint-N-*.md` and its row on the board in `docs/planning/START-HERE.md`. If the user said "next story", pick the topmost ⬜ story whose dependencies are all ✅. Refuse to start if a dependency isn't ✅ (say which) or the story is a 🚧 human gate — those are prepared for a human, never completed autonomously.

**2. Read the context.** The story's PRD section references (e.g. "FR-05", "§13") in `docs/PurrCode-PRD-v0.4.md`, the working agreements in `docs/planning/00-sprint-plan.md`, and any decision records in `docs/decisions/` touching the same subsystem. For spike stories (PC-0xx), switch to the `run-spike` skill instead.

**3. Mark in progress.** Work on the sprint branch (`sprint-N-<short-slug>`, e.g. `sprint-2-reliability`). If it does not exist yet, create it off an up-to-date `main`: `git checkout main && git pull && git checkout -b sprint-N-<short-slug>`. If you are already on that sprint branch (or a legacy story branch being renamed into it), stay there — do not create a per-story branch. Set the story's board row to 🔵. All work for this story — code, checkbox ticks, board updates — happens on the sprint branch, never on `main`.

**4. Implement.** The story's acceptance checkboxes are the definition of done — including the tests each checkbox names. Hard constraints from `AGENTS.md` apply throughout; the fail-silent invariant (exit 0, zero stdout/stderr on hook paths) is P0.

**5. Verify.** Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and — if the story touches daemon/hook/backend behavior — `pnpm e2e:fake-audio` with `PURRCODE_FAKE_AUDIO=1`. All green before closing out. Audio-perception claims (seams, pops, fatigue) are human-only: flag them, don't tick them.

**6. Close out.** In one commit with the code: tick the story's checkboxes in the sprint file, flip the board row to ✅, commit as `type(scope): summary (PC-XYZ)` (e.g. `feat(daemon): session registry state machine (PC-105)`). Push the sprint branch. Open or update the sprint PR to `main` titled `Sprint N: <sprint goal>` (do not open a per-story PR). Report anything discovered that invalidates later backlog items. Continue to the next ready story on the same branch unless the user stops you or a human gate blocks.

## Rules of engagement

- One branch/PR per sprint (`sprint-N-<short-slug>` off `main`); never commit sprint work directly to `main`; stack stories on that branch in board order.
- If a checkbox turns out to be wrong or impossible, don't silently reinterpret it — say so and propose the amendment.
- Leave untouched: release workflows, `sounds/`, `ASSETS.md`, `LICENSE` (CODEOWNERS human gates).
