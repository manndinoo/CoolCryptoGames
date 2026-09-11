#!/usr/bin/env bash
# swap-suite.sh — the five swap-demo.sh modes, each on its own token note and
# a fresh NOCK note for Bob. Results concatenate on stdout; progress on stderr.
# Requires: REPO RUN ALICE_LOCK BOB_LOCK FUND_ARGS, and per instance
# INSTANCES lines "mode|token|note-first note-last|held|steps|proofs|bob-before".
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${INSTANCES:?set INSTANCES}"
while IFS='|' read -r mode token note held steps proofs before; do
  [ -n "$mode" ] || continue
  echo "#### instance $mode token $token note [$note]"
  MODE="$mode" TOKEN="$token" TOKEN_NOTE="$note" TOKEN_HELD="$held" STEPS="$steps" PROOFS="$proofs" EXPECT_BOB_BEFORE="$before" \
    bash "$HERE/swap-demo.sh" || { echo "INSTANCE-FAILED	$mode"; exit 1; }
done <<< "$INSTANCES"
echo "#### suite complete"
