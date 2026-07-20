# 0007 — Package name & trademark hygiene (`purr-code`)

- **Status:** Accepted — **PC-010 confirmed 2026-07-20**
- **Date:** 2026-07-18 (confirmed 2026-07-20)
- **Story:** PC-007 / PC-010
- **PRD refs:** §21 Q5 / §20 row 12

## Question

Is `purrcode` available and hygienic enough as the npm package / product name —
distinct from `claude-purr`, with no "Claude" in the package name (§21 Q5)?

## Evidence

Searches run 2026-07-18. This is a **basic** hygiene check, not a lawyer's
trademark clearance opinion.

| Surface | Query | Result |
|---|---|---|
| npm | `purrcode` | **404 — unclaimed** (`npm view purrcode`), but **publish blocked** 2026-07-20: npm typo-squatting policy — too similar to existing `punycode` |
| npm | `purr-code` | **Reserved 2026-07-20** as `0.0.0` placeholder under account `mathoavito` |
| npm | `claude-purr` | **404 — unclaimed** as a package name |
| npm | fuzzy `claude-purr` | no package of that exact name; Anthropic packages dominate unrelated results |
| GitHub repos | `purrcode in:name` | no competing product repo of that exact name |
| GitHub user | `purrcode` | **exists** — dormant personal/company account ([github.com/purrcode](https://github.com/purrcode)), 0 public repos, last profile update 2020, links `purrcode.pl` (Polish software boutique). Not a Claude Code product. |
| GitHub | `claude-purr in:name` | one unrelated persona repo (`fsdbujgvr/claude-purr-persona`); distinct product, not on npm |
| Adjacent names | `purrjs`, `purr-sist`, `claude-cat`, `code-pet` | different products/games; no collision with our scope |
| This repo | `MathoAvito/purr-code` | already exists — matches the npm package name |
| USPTO / web TM | `PURRCODE` / `PURR CODE` | no software-class mark found in basic search; unrelated `PURR*` marks exist in toys, litter, food, etc. |

Package name contains **no "Claude"** — satisfies §21 Q5 / PRD naming constraint.

## Decision

**Ship npm package as `purr-code`**, product display name **PurrCode**, CLI binary
name **`purrcode`** (via `package.json` `bin`). Rationale:

- Unscoped `purrcode` cannot be published: npm rejects it as too similar to
  `punycode` (confirmed at PC-010 publish attempt).
- `purr-code@0.0.0` placeholder is published and owned by the maintainer.
- Distinct from `claude-purr` and community Claude pets; no "Claude" in the
  package string.
- GitHub repo `MathoAvito/purr-code` already matches the npm name.
- GitHub user `@purrcode` remains taken/unrelated — do **not** depend on that
  handle. Document polish `purrcode.pl` as a known non-conflict if asked.

**Rejected:** unscoped `purrcode` (npm policy). **Deferred alternatives:**
`@mathoavito/purrcode` scoped (unnecessary once `purr-code` reserved), `getpurr`.

## Consequences

- **PC-010 closed:** npm placeholder `purr-code@0.0.0` live; MIT `LICENSE` in
  repo; GitHub remains `MathoAvito/purr-code`.
- Install front door becomes `npx purr-code …` (package name); after install,
  CLI commands stay `purrcode …` (binary name).
- PRD / backlog install strings updated to `npx purr-code` where they meant the
  registry package.
- Not legal advice: a formal clearance search (USPTO TESS + EUIPO + counsel)
  remains optional pre-v1.0 if the project grows commercially.
