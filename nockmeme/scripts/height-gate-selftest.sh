#!/usr/bin/env bash
# Tests wait_for_height offline: a mocked sleep advances the clock, a
# temporary file stands in for the node log. The below-threshold case is the
# one the independent verifier reproduced against the earlier inline loop.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
. ./lib-mine.sh
sleep() { SECONDS=$((SECONDS + 10)); }

fails=0
check() { # check <expect-rc> <log-content> <min> <timeout> <desc>
  local expect="$1" content="$2" min="$3" timeout="$4" desc="$5"
  local log; log=$(mktemp); printf '%s\n' "$content" > "$log"
  local out rc; out=$(wait_for_height "$log" "$min" "$timeout" 2>/dev/null); rc=$?
  rm -f "$log"
  if [ "$rc" = "$expect" ]; then printf 'ok    %s (rc=%s out=%s)\n' "$desc" "$rc" "${out:-}"
  else printf 'FAIL  %s (expected rc %s, got %s, out=%s)\n' "$desc" "$expect" "$rc" "${out:-}"; fails=$((fails+1)); fi
}

check 1 ""                                  3 30 "no blocks at all -> fail"
check 1 "added to validated blocks at 1"    3 30 "height 1 below minimum 3 -> fail (the reproduced bug)"
check 1 "added to validated blocks at 2"    3 30 "height 2, one short -> fail"
check 0 "added to validated blocks at 3"    3 30 "height 3 meets minimum 3 -> pass"
check 0 "added to validated blocks at 7"    3 30 "height 7 exceeds minimum -> pass"
check 0 $'added to validated blocks at 1\nadded to validated blocks at 5' 3 30 "latest line wins -> pass"

echo
if [ "$fails" -eq 0 ]; then echo "height-gate self-test: all checks passed"; else echo "height-gate self-test: $fails FAILED"; exit 1; fi
