# Sprint 4 — Plugin Packaging, OSS Surface & v0.1.0 (28 pts)

**Goal:** ship. Plugin install/uninstall meets the §8 stories, the §22 Definition of Done is checked line by line, and v0.1.0 is on npm with provenance.

**Human gates this sprint:** branch protection / GitHub settings (**PC-406**), licensing sign-off (in **PC-408**), release approval (**PC-409**). (PC-405 is agent-facing `AGENTS.md` / `CLAUDE.md` polish — not a GitHub settings gate.)

---

## PC-401 — Plugin package (5 pts, E7)

**As a** user, **I want** PurrCode as a Claude Code plugin **so that** my `settings.json` is never touched (FR-01, §15).

- [x] Plugin layout with `hooks/hooks.json` exactly per §15: **exec form mandatory** (`command: "node"`, `args` with `${CLAUDE_PLUGIN_ROOT}/dist/hook.js`) — string-form is forbidden (ADR 0002/0006: breaks ppid = Claude and refcounting). `async: true`, `timeout: 5`, no `matcher` fields, all four events.
- [x] Hook adapter, daemon, CLI bundled into the plugin's `dist/`; persistent state (config, sounds, WAV cache) in `${CLAUDE_PLUGIN_DATA}` so it survives plugin updates (per PC-005 findings).
- [x] `sleepy` + license metadata bundled; WAV cache generated at install.
- [ ] Validated end-to-end against a real Claude Code on all three OSes: prompt → purr → stop → silence, zero transcript artifacts. *(Linux 2026-07-22: `claude plugin validate` + marketplace install + headless turn → zero transcript artifacts, `settings.json` untouched, `preparePluginData` WAV cache under `${CLAUDE_PLUGIN_DATA}`. macOS/Windows + perceptual prompt→purr→stop still human.)*

## PC-402 — `npx purr-code install` (5 pts, E7)

**As a** new user, **I want** one idempotent command **so that** installation matches the §14 experience.

- [x] Detects Claude Code (version-checked); registers the plugin via the PC-005-documented flow; installs default purr; verifies audio playback and reports the detected tier.
- [x] Idempotent: re-running detects the existing install and reports rather than duplicating (RR-03, §8).
- [x] Reports what was installed and where; failure output explains cause + fix; suggests `preview` and `volume` next steps per §14.
- [x] Works via `npx` and global install; **the installed hooks themselves never depend on PATH or npx** (§13).
- [x] Integration test with a mocked plugin-registration layer; manual verification on the three OSes. *(Linux 2026-07-22 real `purrcode install` + idempotent re-run OK. macOS/Windows manual still human.)*

## PC-403 — `purrcode uninstall` (3 pts, E7)

**As a** user, **I want** clean removal **so that** nothing unrelated changes (§8 uninstall story).

- [x] Disables/removes the plugin; stops the daemon (fade first), removes runtime state, socket, pidfile.
- [x] **Plugin data** (`${CLAUDE_PLUGIN_DATA}`) is deleted by default; retain with **`--keep-data`** (ADR 0005). User-imported audio retained unless `--purge` (mechanism ships now even though import UI is Phase 2) — clarify interaction: `--keep-data` keeps plugin data; `--purge` removes imported audio when that surface exists.
- [x] Idempotent; reports exactly what was removed.
- [x] Test: install → use → uninstall leaves no PurrCode process, hook, or runtime residue (config/data only with `--keep-data` / without `--purge` as specified).

## PC-404 — Community health files (3 pts, E8)

**As a** first-time contributor (human or agent), **I want** the §23.1 file set **so that** contributing has a defined surface.

- [x] `README.md`: install, uninstall, architecture sketch, privacy statement, troubleshooting, badges (CI, npm; Scorecard badge slot).
- [x] `CONTRIBUTING.md`: dev setup (`pnpm install`, `pnpm test`, `pnpm e2e:fake-audio`), testing hooks against local Claude Code, PR expectations, DCO instructions, AI-assisted contribution policy (§23.5: disclosure checkbox, submitter accountability, fast-close for untested bulk submissions, no agent-contributed audio, no agent DCO sign-off), BDFL governance note (§23.6), scope-discipline pointer to PRD §5.
- [x] `CODE_OF_CONDUCT.md` (Contributor Covenant, named enforcement contact), `SECURITY.md` (GitHub Security Advisories, 7-day acknowledgment, no public PoC pre-fix).
- [x] Issue templates: bug report (requires `doctor` output + OS/tier), feature request (must address non-goals). PR template: test checklist, licensing checklist, AI-disclosure checkbox. (Sound-submission template is Phase 2 / E9.)
- [x] `CODEOWNERS`: maintainer review on `hooks/`, release workflows, `sounds/`.

## PC-405 — AGENTS.md + CLAUDE.md (2 pts, E8)

**As a** coding agent, **I want** canonical repo context **so that** agent contributions verify their own changes correctly (§23.5).

- [x] `AGENTS.md`: exact build/lint/test/e2e commands with flags; architecture map (hook adapter → daemon → backend tiers); hard constraints (no new runtime deps without a linked issue, no network code anywhere, never modify release workflows or `sounds/` licensing files, all child processes in exec form); headless verification via `PURRCODE_FAKE_AUDIO=1`.
- [x] `CLAUDE.md`: one line pointing to `AGENTS.md`.
- [x] Verified by pointing a fresh coding agent at the repo with a trivial task; friction fixed.

## PC-406 — CI security hardening & DCO (3 pts, E8) — human gate for repo settings

**As the** maintainer, **I want** the §23.3 fork-PR rules enforced **so that** the secret-exfiltration and release-poisoning risks (§20) are structurally closed.

- [x] Fork PRs: `pull_request` trigger only; **`pull_request_target` + fork checkout banned** (enforced by a workflow-lint check in CI, not just convention).
- [x] Zero secrets in PR workflows; least-privilege `permissions` per job; SHA pins audited; Renovate/Dependabot configured to keep pins and deps current; secret scanning enabled. *(Dependabot + SHA lint in-repo; **secret scanning** still human in GitHub settings — see `docs/planning/reviews/pc-406-human-gate.md`.)*
- [ ] DCO check required on all PRs. *(CI workflow `.github/workflows/dco.yml` shipped; human must mark it **required** on `main`.)*
- [ ] Branch protection on `main` (human applies): required CI matrix, required review, squash merge, linear history.

## PC-407 — Release pipeline: Changesets + protected npm publish (3 pts, E8)

**As the** maintainer, **I want** a releases-from-tags-only pipeline **so that** no PR-triggered workflow can ever publish (§23.3, §13).

- [x] Changesets configured; user-facing changes require a changeset (CI-enforced).
- [x] Publish workflow: tags on `main` only, behind a **protected `release` GitHub environment**, npm provenance enabled; sidecar binaries built in CI from source with checksums published alongside the release. *(Workflow + packages ready; human must create the `release` environment + npm Trusted Publisher before first tag — see `docs/planning/reviews/pc-407-pc-409-human-notes.md`.)*
- [x] Dry-run release rehearsal documented in CONTRIBUTING (reproducible release procedure per §13).

## PC-408 — Definition-of-Done audit (3 pts, E8) — human gate on licensing line

**As the** product owner, **I want** every §22 checkbox verified against the built artifact **so that** "done" means the PRD's done, not vibes.

- [ ] Walk §22 line by line on fresh machines/VMs for macOS, Ubuntu, Windows: one-command install, untouched `settings.json`, start/stop/failure/abandoned/suspend-resume behavior within watchdog bounds, zero transcript artifacts, two-session correctness, no orphaned audio in any tested failure mode, config survives install/remove, no transcript/prompt data read or stored, bundled-audio rights verified (human), CI matrix green including fake-audio suite, community files + DCO + fork-PR rules in place, README complete.
- [ ] Every gap becomes a blocking bug; the audit re-runs after fixes.

## PC-409 — v0.1.0 release (1 pt, E8) — human gate

- [ ] Version tagged, published to npm with provenance under the PC-010 name; GitHub release with checksums and notes; README badges live.
- [ ] Post-release smoke test: `npx purr-code install` from the public registry on one machine per OS.
- [ ] MVP retro + Phase 2 story breakdown scheduled (E9–E11).
