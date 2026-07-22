# Contributing to PurrCode

Thanks for helping the cat hum. This document is the human contribution surface; coding agents should also read [`AGENTS.md`](AGENTS.md).

## Governance

PurrCode launches under a **BDFL** model (single maintainer: [@MathoAvito](https://github.com/MathoAvito)). Decisions happen in public GitHub issues. The [PRD](docs/PurrCode-PRD-v0.4.md) is the roadmap; amendments to it are PRs like everything else. Commit bit is offered after a track record of sustained, quality contributions.

**Scope discipline:** PRs that expand into [PRD §5 non-goals](docs/PurrCode-PRD-v0.4.md) are closed with a pointer to the PRD, kindly. Prefer a small, reliable toy over a general audio toolkit.

## Development setup

Requirements: Node.js 20+, pnpm (see `packageManager` in root `package.json`).

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm e2e:fake-audio          # set PURRCODE_FAKE_AUDIO=1 in CI; local is fine either way
```

Optional (real tier-1 sidecar):

```bash
pnpm sidecar:fetch-vendor
pnpm sidecar:build
pnpm e2e:sidecar
```

Plugin package (Claude Code layout):

```bash
pnpm plugin:build            # assemble + `claude plugin validate` when Claude CLI is present
```

MVP CLI after build: `pnpm --filter purr-code build`, then `node packages/cli/dist/cli.js …` (or link the package).

## Testing hooks against local Claude Code

1. `pnpm plugin:build`
2. `node packages/cli/dist/cli.js install` (or `claude plugin marketplace add ./packages/plugin/marketplace` then `claude plugin install purrcode@purrcode`)
3. Start a real Claude Code session; submit a prompt — the purr should fade in, then out on stop.
4. Confirm zero hook-error notices in the transcript.
5. `node packages/cli/dist/cli.js uninstall` when done.

Headless / CI verification uses the fake audio backend (`PURRCODE_FAKE_AUDIO=1`). Perceptual audio QA (seams, pops, fatigue) is human-only.

## Pull requests

- One git branch per sprint for backlog work (`sprint-N-<slug>`); small fixes may use a focused branch.
- Conventional commits with story IDs when applicable: `feat(cli): … (PC-402)`.
- User-facing changes will require a Changeset once PC-407 lands.
- Fill out the PR template (tests, licensing, AI disclosure).
- Keep PRs reviewable; unverified bulk submissions may be closed without extended triage.

### DCO (Developer Certificate of Origin)

We use **DCO, not a CLA**. Every commit must be signed off:

```bash
git commit -s -m "feat(…): …"
```

That adds a `Signed-off-by:` line certifying the [DCO](https://developercertificate.org/). A DCO check will be required on PRs (PC-406). **You** must sign — agents may not sign the DCO on a human's behalf.

## AI-assisted contributions (§23.5)

AI-assisted and agent-authored PRs are welcome. The **human submitter remains fully responsible**: understand the change, run the tests, and be able to discuss it in review.

- Disclose substantially agent-generated work via the PR template checkbox.
- Unverified bulk submissions (clearly untested / unread) are closed without extended triage.
- Agents may **not** contribute audio assets (see `ASSETS.md` / PRD §23.4).
- Agents may **not** sign the DCO for you.

## Audio / `sounds/`

Do not open sound-submission PRs until the Phase 2 template lands. Bundled audio must be CC0 or original work; every `sounds/` change updates `ASSETS.md` in the same commit. Maintainer review + a listen pass is required.

## Security

See [SECURITY.md](SECURITY.md). Never file a public issue with a working exploit before a fix ships.

## Code of conduct

[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) — Contributor Covenant. Enforcement contact: [@MathoAvito](https://github.com/MathoAvito).
