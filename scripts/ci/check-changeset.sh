#!/usr/bin/env bash
# PC-407 — require a changeset when user-facing paths change on a PR.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

BASE_REF="${GITHUB_BASE_REF:-main}"
# Local fallback: diff against origin/main or main.
if git rev-parse --verify "origin/${BASE_REF}" >/dev/null 2>&1; then
  RANGE="origin/${BASE_REF}...HEAD"
elif git rev-parse --verify "${BASE_REF}" >/dev/null 2>&1; then
  RANGE="${BASE_REF}...HEAD"
else
  echo "No base ref; skipping changeset check."
  exit 0
fi

CHANGED="$(git diff --name-only "$RANGE" || true)"
if [[ -z "$CHANGED" ]]; then
  echo "No changed files in range $RANGE."
  exit 0
fi

# Paths that require a changeset when touched.
if ! echo "$CHANGED" | grep -E '^(packages/cli/|packages/sidecar-|packages/plugin/|sounds/)' >/dev/null; then
  echo "No user-facing package paths changed; changeset not required."
  exit 0
fi

# Allow docs-only / test-only under those trees without a changeset? Prefer requiring
# a changeset for any packages/cli src change; skip pure docs/markdown.
if ! echo "$CHANGED" | grep -E '^(packages/cli/src/|packages/cli/package\.json|packages/sidecar-[^/]+/|packages/plugin/marketplace/|sounds/)' >/dev/null; then
  echo "Only non-publish surface changes; changeset not required."
  exit 0
fi

if echo "$CHANGED" | grep -E '^\.changeset/.+\.md$' >/dev/null; then
  echo "Changeset file present."
  exit 0
fi

# Also accept an empty changeset directory marker from `changeset --empty` — still a file.
if ls .changeset/*.md >/dev/null 2>&1; then
  # Ensure at least one changeset is new in this PR range.
  if echo "$CHANGED" | grep -E '^\.changeset/' >/dev/null; then
    echo "Changeset updates present."
    exit 0
  fi
fi

echo "::error::User-facing changes require a Changeset. Run: pnpm exec changeset"
echo "Changed publish-surface files:"
echo "$CHANGED" | grep -E '^(packages/cli/src/|packages/cli/package\.json|packages/sidecar-|packages/plugin/marketplace/|sounds/)' || true
exit 1
