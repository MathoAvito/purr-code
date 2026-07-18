---
name: run-spike
description: Run a PurrCode Sprint 0 technical spike (PC-001..PC-007) and produce a decision record. Use when the user asks to run, execute, or investigate a spike story, or to verify a PRD assumption (hook payloads, PID handles, named pipes, audio sidecar, plugin packaging).
---

# Run a technical spike

Spikes answer questions; they do not build product code. Output is a **decision record**, not a merged feature.

## Workflow

1. Read the spike story in `docs/planning/sprint-0-spikes.md` and the PRD sections it cites. Create the story branch off an up-to-date `main` (`pc-00X-<short-slug>`, e.g. `pc-001-hook-payload-spike`) — spikes follow the branch-per-story rule too. Mark the board row 🔵 in `docs/planning/START-HERE.md`.
2. Timebox to the story's point value in effort. Prototype code goes in `spikes/pc-00X-<topic>/` — throwaway by definition, excluded from lint/CI quality gates, never imported by product code.
3. Test every checkbox item **empirically** on the platforms it names. Record raw evidence (captured payloads, command output, timings) in the spike folder. Where a platform is unavailable locally, say so explicitly in the record — never extrapolate a finding across platforms.
4. Write the decision record to `docs/decisions/NNNN-<topic>.md` using `docs/decisions/TEMPLATE.md`. The Decision section must be actionable enough that a later story can cite it without re-investigating.
5. **Reconcile the backlog:** if a finding contradicts a PRD assumption, list the affected stories (by PC-ID) in the record's Consequences section and flag them for the PC-009 go/no-go — don't edit later sprint files unilaterally.
6. Close out: tick the spike's checkboxes, flip its board row to ✅, commit as `docs(spike): <topic> findings (PC-00X)`, push the branch, and open a PR to `main` titled `PC-00X: <spike title>`.

## A spike that can't conclude

If the timebox expires without an answer, that is a valid outcome: write the record anyway with status "Inconclusive", state exactly what evidence is missing and what would be needed to get it, and mark the board row ⛔ with a one-line reason.
