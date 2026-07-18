# 0007 — Package name & trademark hygiene (`purrcode`)

- **Status:** Accepted (evidence); **final name confirmation is a human decision (PC-010)**
- **Date:** 2026-07-18
- **Story:** PC-007
- **PRD refs:** §21 Q5 / §20 row 12

## Question

Is `purrcode` available and hygienic enough as the npm package / product name —
distinct from `claude-purr`, with no "Claude" in the package name (§21 Q5)?

## Evidence

Searches run 2026-07-18. This is a **basic** hygiene check, not a lawyer's
trademark clearance opinion.

| Surface | Query | Result |
|---|---|---|
| npm | `purrcode` | **404 — unclaimed** (`npm view purrcode`) |
| npm | `claude-purr` | **404 — unclaimed** as a package name |
| npm | fuzzy `claude-purr` | no package of that exact name; Anthropic packages dominate unrelated results |
| GitHub repos | `purrcode in:name` | no competing product repo of that exact name |
| GitHub user | `purrcode` | **exists** — dormant personal/company account ([github.com/purrcode](https://github.com/purrcode)), 0 public repos, last profile update 2020, links `purrcode.pl` (Polish software boutique). Not a Claude Code product. |
| GitHub | `claude-purr in:name` | one unrelated persona repo (`fsdbujgvr/claude-purr-persona`); distinct product, not on npm |
| Adjacent names | `purr-code`, `purrjs`, `purr-sist`, `claude-cat`, `code-pet` | different products/games; no collision with our scope |
| This repo | `MathoAvito/purr-code` | already exists (private) — hyphenated GitHub name is fine alongside unhyphenated npm `purrcode` (esbuild-style precedent) |
| USPTO / web TM | `PURRCODE` / `PURR CODE` | no software-class mark found in basic search; unrelated `PURR*` marks exist in toys, litter, food, etc. |

Package name contains **no "Claude"** — satisfies §21 Q5 / PRD naming constraint.

## Decision

**Recommend shipping as `purrcode`** (npm package + CLI binary name), with
product display name **PurrCode**. Rationale:

- npm name is free today.
- Distinct from the (also-unclaimed) `claude-purr` string the PRD worried about,
  and from community Claude pets (`claude-cat`, `code-pet`, `/buddy`).
- No "Claude" in the package string.
- GitHub user `@purrcode` is taken but dormant and unrelated — do **not** depend
  on owning that handle. Keep the repo under the maintainer org/user
  (`MathoAvito/purr-code` or a new org like `purrcode-dev`); document the
  polish `purrcode.pl` company as a known non-conflict in README FAQ if anyone
  asks.

**Rejected / deferred alternatives** (only if human overrides at PC-010):
`purr-code` (npm), `getpurr`, `@purrcode/cli` scoped — unnecessary unless the
unscoped name is sniped before PC-010 publishes the placeholder.

## Consequences

- **PC-010 (human):** publish npm placeholder `purrcode` (or reserve), confirm
  GitHub visibility/org, add MIT `LICENSE`. Act soon — the name is free *now*.
- **No PRD amendment** — §21 Q5 answered with the recommended name.
- Not legal advice: a formal clearance search (USPTO TESS + EUIPO + counsel)
  remains optional pre-v1.0 if the project grows commercially.
