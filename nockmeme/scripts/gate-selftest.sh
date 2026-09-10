#!/usr/bin/env bash
# Tests the verify-hash decision logic against the wallet's real output
# strings. Runs offline; needs no wallet, node, or signature.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
. ./lib-verify.sh

VALID='# Valid signature, hash verified'
INVALID='# Invalid signature, hash not verified'

fails=0
check() { # check <expect 0|1> <rc> <output> <description>
  local expect="$1" rc="$2" out="$3" desc="$4"
  verify_decision "$rc" "$out"; local got=$?
  if [ "$got" = "$expect" ]; then
    printf 'ok    %s\n' "$desc"
  else
    printf 'FAIL  %s (expected %s, got %s)\n' "$desc" "$expect" "$got"
    fails=$((fails+1))
  fi
}

check 0 0 "$VALID"   "valid signature, exit 0 -> accept"
check 1 1 "$INVALID" "invalid signature, exit 1 -> reject"

# The regression. `grep -i valid` matches "Invalid", so the old gate accepted
# this. Demonstrated rather than asserted, so the failure mode stays visible.
if printf '%s' "$INVALID" | grep -qi 'valid'; then
  printf 'ok    "Invalid signature" does match grep -i valid (the old bug)\n'
else
  printf 'FAIL  expected grep -i valid to match "Invalid signature"\n'; fails=$((fails+1))
fi
check 1 1 "$INVALID" "...but verify_decision rejects it"

# Disagreement between exit code and text is not success either way.
check 1 0 "$INVALID" "exit 0 with failure text -> reject"
check 1 1 "$VALID"   "exit 1 with success text -> reject"

# Anything unrecognised is a failure, not a pass.
check 1 0 ""                        "empty output -> reject"
check 1 0 "error: connection refused" "unrelated error -> reject"
check 1 2 "$VALID"                  "crash exit code -> reject"

echo
if [ "$fails" -eq 0 ]; then
  echo "gate self-test: all checks passed"
else
  echo "gate self-test: $fails check(s) FAILED"
  exit 1
fi
