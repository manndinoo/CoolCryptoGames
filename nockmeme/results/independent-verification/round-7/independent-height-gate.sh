#!/usr/bin/env bash
set -euo pipefail
RUN=$(mktemp -d)
trap 'rm -rf "$RUN"' EXIT
printf '%s\n' 'added to validated blocks at 1' > "$RUN/node.log"
MINE_TIMEOUT=1 MIN_HEIGHT=3
sleep() { SECONDS=$((SECONDS + 10)); }
die() { echo "FAIL: $*" >&2; exit 1; }
HEIGHT=""
DEADLINE=$((SECONDS + ${MINE_TIMEOUT:-1800}))
while (( SECONDS < DEADLINE )); do
  HEIGHT=$(grep -ao "added to validated blocks at [0-9]*" "$RUN/node.log" 2>/dev/null \
           | tail -1 | grep -oE '[0-9]+$' || true)
  [ -n "$HEIGHT" ] && [ "$HEIGHT" -ge "${MIN_HEIGHT:-3}" ] && break
  sleep 10
done
[ -n "$HEIGHT" ] || die "no block mined within ${MINE_TIMEOUT:-1800}s"
echo "height=$HEIGHT"

echo "BUG REPRODUCED: proceeded below MIN_HEIGHT=$MIN_HEIGHT"
