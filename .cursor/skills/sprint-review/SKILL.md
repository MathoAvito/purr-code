---
name: sprint-review
description: Prepare a PurrCode sprint-end review package for the human gate. Use when the user asks to close a sprint, run a sprint review or retro, or check whether a sprint is done.
---

# Prepare a sprint review

The sprint boundary is a human review gate. The agent prepares the evidence; the human decides.

## Workflow

1. **Audit the board.** In `docs/planning/START-HERE.md`, every non-gate story of the sprint must be ✅ with all acceptance checkboxes ticked in the sprint file. List any that aren't, with what remains.
2. **Run the proof.** `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm e2e:fake-audio`; confirm CI is green on the full matrix (macOS/Ubuntu/Windows). Then execute the "Demo at sprint review" scenario from the top of the sprint file and capture its output.
3. **Assemble the gate items.** List the sprint's 🚧 stories with exactly what the human must do or decide (e.g. PC-009 go/no-go, licensing sign-off, manual audio QA steps from §18, GitHub settings).
4. **Write the review package** as `docs/planning/reviews/sprint-N-review.md`:
   - Story table: ID, title, points, status, PR links.
   - Demo evidence (test output, fake-audio event logs).
   - Deviations: unticked boxes, scope changes, discovered follow-ups (proposed as new story IDs).
   - Decision records produced this sprint.
   - Open items for the human gate, as an explicit checklist.
5. **Stop.** Do not mark gate items ✅, do not start next-sprint stories, do not tag releases. Present the package and end.

## Sprint 0 special case

The PC-009 go/no-go additionally requires a backlog-reconciliation section: every spike finding that contradicts a PRD assumption, mapped to the later stories it affects, with proposed edits — applied only after human approval.
