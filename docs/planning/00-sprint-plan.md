# PurrCode — Sprint Plan (through MVP v0.1.0)

**Source:** [PRD v0.4](../PurrCode-PRD-v0.4.md)
**Team:** 1 developer + coding agents
**Cadence:** nominal 2-week sprints; with agent execution the sprint boundary is a *scope and review* boundary, not a calendar one. Each sprint ends with a human review gate.
**Estimation:** Fibonacci story points (1, 2, 3, 5, 8). Points measure complexity/risk, not hours. Budget ≈ 25–30 pts per sprint.

---

## Sequencing rationale (read this before arguing with the plan)

1. **Risk first.** The PRD's four highest-impact risks (§20) are all *unknowns*, not build work: does Esc fire `Stop`? Is the hook's parent PID a reliable handle on Claude Code? Do Windows named pipes work in elevated/enterprise contexts? Can we get a gapless-loop + fade tier-1 sidecar on all three OSes? Sprint 0 answers these before we commit architecture. **Sprint 0 has a go/no-go gate (PC-009).**
2. **Skeleton before flesh.** The daemon/session-registry/state-machine subsystem (FR-05) is where almost every PRD edge case lives. We build and integration-test it against the **fake audio backend** (§23.5) first — Sprint 1–2 — so all concurrency/race/watchdog logic is deterministic and agent-verifiable long before a sound card is involved. This also front-loads the fake backend, which is itself an MVP deliverable.
3. **Real audio is an adapter swap.** By Sprint 3 the `AudioBackend` interface is proven; the tier-1 sidecar, mpv, and degraded tiers slot in behind it. CLI and doctor land here because they talk to a now-stable daemon.
4. **Packaging and OSS last, but not least.** Plugin packaging, install/uninstall, community health files, DCO/branch protection, and fork-PR CI security are Sprint 4 — they're MVP Definition-of-Done items (§22) but depend on everything else being shaped.

## Sprint overview

| Sprint | Theme | Milestone | Points |
|---|---|---|---|
| 0 | Technical spikes + scaffolding | PRD Phase 0 exit criteria met; go/no-go decision | 29 |
| 1 | Walking skeleton (hooks → daemon → fake audio) | Purr lifecycle works end-to-end with fake audio in CI | 30 |
| 2 | Reliability & reconciliation | All RR-01…RR-05 behaviors pass integration suite | 27 |
| 3 | Real audio + CLI + doctor | Audible purr on 3 OSes; full CLI surface for MVP | 30 |
| 4 | Plugin packaging, OSS surface, release | **v0.1.0 published**; §22 Definition of Done met | 28 |

Phases 2 (v0.5.0 beta) and 3 (v1.0.0) are captured at **epic level only** in [01-epics.md](01-epics.md); they get story breakdown after the MVP retro.

## Working agreements

- **Definition of Done (per story):** acceptance criteria met; unit tests written and green; integration tests updated where the story touches daemon/hook behavior; lint clean; no new runtime dependencies without an explicit note; PRD section cross-referenced in the PR description.
- **Fail-silent is non-negotiable:** any story touching hook handlers must include a test that the handler exits 0 and prints nothing on stdout/stderr under failure (RR-02). This is the product's core invariant — a single transcript error notice is a P0 bug.
- **Spike output format:** every Sprint 0 spike produces a short decision record in `docs/decisions/` (finding, evidence, decision, impact on backlog). Spikes are timeboxed; a spike that can't conclude produces a "what we'd need to find out" record, not more spiking.
- **Platform coverage:** every sprint from 1 onward keeps the CI matrix (macOS, Ubuntu, Windows) green. Platform-specific code lands with platform-specific tests or an explicit manual-QA note.
- **Backlog IDs:** `PC-<sprint><nn>` (PC-101 = Sprint 1, story 01). Epics are `E<n>`.

## Human review gates (things agents can't sign off)

- Sprint 0: go/no-go on spike findings; final package name (PC-010).
- Sprint 3: manual audio QA — seam audibility, pops, 15-minute fatigue test (§18).
- Sprint 4: licensing sign-off on the bundled sound; release approval; branch-protection and GitHub org settings.

## Out of scope for these sprints (deliberately)

Custom sound import, the other three bundled purrs, direct-hook fallback installer, WSL support, attention-mode — all Phase 2+ per the PRD release plan (§19). PRs drifting into §5 non-goals get closed with a pointer to the PRD, kindly.
