# PC-407 / PC-409 — release pipeline prep notes

## Agent-prepared (PC-407)

- [x] Changesets: `.changeset/config.json`, `@changesets/cli`, `pnpm changeset` / `pnpm version-packages`
- [x] CI: `.github/workflows/changeset.yml` + `scripts/ci/check-changeset.sh`
- [x] Publish workflow: `.github/workflows/release.yml` — **tag `v*` only**, `environment: release`, npm provenance, sidecar build + checksums on GitHub Release
- [x] Dry-run procedure documented in `CONTRIBUTING.md`

## Human before first publish (PC-409)

- [ ] Create GitHub Environment **`release`**: deployment branches = `main` only; required reviewers
- [ ] Configure npm **Trusted Publisher** for `MathoAvito/purr-code` → workflow `release.yml`, environment `release`
- [ ] Confirm PC-406 branch protection is live
- [ ] Run `pnpm version-packages` for `0.1.0`, tag `v0.1.0` on `main`, push tag
- [ ] Post-release smoke: `npx purr-code install` on one machine per OS

Agents must not tag or publish.
