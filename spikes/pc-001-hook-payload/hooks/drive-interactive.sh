#!/usr/bin/env bash
# PC-001 throwaway: drive interactive Claude Code through a PTY with scripted keys.
# Usage: drive-interactive.sh <scenario-name> <keyscript-file> [total-seconds]
# keyscript-file lines:  SLEEP <sec>   |   KEYS <literal chars>   |   RAW <hex bytes e.g. 1b for Esc>
set -u
SCENARIO="$1"; KEYSCRIPT="$2"; TOTAL="${3:-30}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
FIFO=$(mktemp -u /tmp/pc001-fifo-XXXX); mkfifo "$FIFO"
OUT="$DIR/evidence/tui-$SCENARIO.log"

# keep fifo writer open for the whole run
exec 3<>"$FIFO"

cd "$DIR/testbed"
script -qfc "claude" "$OUT" <"$FIFO" &
SCRIPT_PID=$!

(
  while IFS= read -r line; do
    cmd="${line%% *}"; arg="${line#* }"
    case "$cmd" in
      SLEEP) sleep "$arg" ;;
      KEYS)  printf '%s' "$arg" >&3 ;;
      ENTER) printf '\r' >&3 ;;
      RAW)   printf "$(echo "$arg" | sed 's/../\\x&/g')" >&3 ;;
    esac
  done < "$KEYSCRIPT"
) &
FEEDER=$!

SECONDS=0
while kill -0 "$SCRIPT_PID" 2>/dev/null && [ "$SECONDS" -lt "$TOTAL" ]; do sleep 1; done
kill "$FEEDER" 2>/dev/null
if kill -0 "$SCRIPT_PID" 2>/dev/null; then
  # graceful: Ctrl+C twice then kill
  printf '\x03' >&3; sleep 1; printf '\x03' >&3; sleep 2
  kill "$SCRIPT_PID" 2>/dev/null
fi
exec 3>&-
rm -f "$FIFO"
echo "scenario $SCENARIO done; tui log: $OUT"
