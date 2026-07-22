#!/usr/bin/env bash
# PC-406 / PRD §23.3 — structural checks on GitHub Actions workflows.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WF_DIR="$ROOT/.github/workflows"
fail=0

if [[ ! -d "$WF_DIR" ]]; then
  echo "No workflows directory; nothing to lint."
  exit 0
fi

shopt -s nullglob
files=("$WF_DIR"/*.yml "$WF_DIR"/*.yaml)
if ((${#files[@]} == 0)); then
  echo "No workflow files found."
  exit 0
fi

for f in "${files[@]}"; do
  base="$(basename "$f")"
  # Ban pull_request_target entirely (classic secret-exfiltration pattern with fork checkout).
  if grep -nE '^[[:space:]]*pull_request_target[[:space:]]*:' "$f" >/dev/null; then
    echo "::error file=$f::pull_request_target is banned (PRD §23.3 / PC-406)"
    grep -nE '^[[:space:]]*pull_request_target[[:space:]]*:' "$f" || true
    fail=1
  fi

  # Every 'uses:' must be pinned to a 40-char SHA (optional trailing comment).
  while IFS= read -r line; do
    # Skip local actions
    if [[ "$line" =~ uses:[[:space:]]*\./ ]]; then
      continue
    fi
    if [[ "$line" =~ uses:[[:space:]]*([^[:space:]#]+) ]]; then
      ref="${BASH_REMATCH[1]}"
      # Expect owner/repo@<40 hex>
      if [[ ! "$ref" =~ @[0-9a-f]{40}$ ]]; then
        echo "::error file=$f::Action not SHA-pinned: $ref (in $base)"
        fail=1
      fi
    fi
  done < <(grep -E '^[[:space:]]*-?[[:space:]]*uses:' "$f" || true)
done

if ((fail)); then
  echo "Workflow lint failed."
  exit 1
fi

echo "Workflow lint OK (${#files[@]} file(s))."
