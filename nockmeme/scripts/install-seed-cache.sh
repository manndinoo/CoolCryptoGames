#!/usr/bin/env bash
# Install a seed cache produced elsewhere by generate-seed-cache.sh, so the
# node here skips the generation phase it cannot afford.
#
# Nothing is trusted on this side beyond the file's shape: the node validates
# every context rebuilt from these seeds against its consensus-committed
# digest and aborts startup on a mismatch (ai-pow-jets/docs/VERIFIER_SETUP.md).
#
# Usage: install-seed-cache.sh <nmeme-seed-cache.tar.gz> <run-dir> [expected-sha256]
set -euo pipefail
TAR="${1:?usage: install-seed-cache.sh <tar.gz> <run-dir> [sha256]}"
RUN="${2:?usage: install-seed-cache.sh <tar.gz> <run-dir> [sha256]}"
EXPECT="${3:-}"
mkdir -p "$RUN/data"
tar -C "$RUN/data" -xzf "$TAR"
SEED="$RUN/data/ai-pow/verifier-setup-seeds-v1.bin"
[ -s "$SEED" ] || { echo "archive did not contain ai-pow/verifier-setup-seeds-v1.bin" >&2; exit 1; }
[ "$(head -c 8 "$SEED")" = "NCVPSEED" ] || { echo "$SEED lacks the NCVPSEED magic" >&2; exit 1; }
SHA=$(sha256sum "$SEED" | cut -d' ' -f1)
if [ -n "$EXPECT" ] && [ "$SHA" != "$EXPECT" ]; then
  echo "sha256 mismatch: got $SHA, expected $EXPECT" >&2; exit 1
fi
echo "installed $SEED"; echo "sha256 $SHA"; echo "bytes $(stat -c %s "$SEED")"
echo "next: bash scripts/node-lowmem.sh <repo> $RUN   (same --data-dir; generation is skipped)"
