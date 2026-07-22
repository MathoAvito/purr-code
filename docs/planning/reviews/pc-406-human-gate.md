# PC-406 — Human gate checklist (repo settings)

Agent-prepared automation is on the sprint branch. A human must apply GitHub repository settings below; agents must **not** flip this story to ✅.

## Already in the repo (agent)

- [x] CI uses `pull_request` only (no `pull_request_target`) — enforced by `scripts/ci/lint-workflows.sh` + `.github/workflows/workflow-lint.yml`
- [x] Workflows declare least-privilege `permissions`; Action `uses:` SHA-pinned (linted)
- [x] DCO CI check: `.github/workflows/dco.yml` (`christophebedard/dco-check@…`)
- [x] Dependabot: `.github/dependabot.yml` (github-actions + npm)

## Human must apply in GitHub settings

### Branch protection on `main`

Settings → Branches → Branch protection rule for `main`:

- [ ] Require a pull request before merging
- [ ] Require approvals: **1**
- [ ] Require status checks to pass:
  - CI matrix jobs (`ubuntu-latest`, `macos-latest`, `windows-latest`)
  - `sidecar-*` jobs (as desired)
  - `DCO / signed-off-by`
  - `Workflow lint / no-pull-request-target`
- [ ] Require linear history
- [ ] Prefer **Squash merge** (disable merge commit / rebase if desired for linear history)
- [ ] Do not allow bypassing (except temporary break-glass)

### Secret scanning

Settings → Code security:

- [ ] Enable **Secret scanning**
- [ ] Enable **Push protection** (recommended)

### DCO as required check

- [ ] After first green run of `dco.yml` on a PR, mark **DCO / signed-off-by** as a required status check on `main`

### Optional Scorecard (later / PC-407+)

- [ ] OpenSSF Scorecard Action on `main` (badge already slotted in README)

## Sign-off

When the checklist above is done, a human may tick PC-406 acceptance boxes in `docs/planning/sprint-4-packaging-release.md` and set the board row to ✅.
