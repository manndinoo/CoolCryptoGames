#!/usr/bin/env bash
# Compiles the consensus upgrade candidate's 24 Hoon assertions with the
# workspace's honk compiler and requires the emitted formula to be the
# constant 24 (every assertion true). Run in a Nockchain checkout at the
# pinned revision with upstream/amm-covenant.patch AND upstream/activation.patch
# applied, after `cargo build --release -p honk --bin honk`.
#   bash scripts/verify-activation.sh /path/to/nockchain [out.jam]
# Needs vm.overcommit_memory=1 (the Nock stack is reserved up front; without
# it honk panics in NockStack::new before compiling anything).
set -euo pipefail
REPO="${1:?nockchain checkout}"; OUT="${2:-$(mktemp -d)/assertions.jam}"
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO"
test -f hoon/common/nmeme-policy.hoon || { echo "activation.patch is not applied here"; exit 2; }
"$REPO/target/release/honk" --new --dynock --output "$OUT" --prelude hoon/common/hoon.hoon \
  hoon/tests/dumb/nmeme-upgrade-check.hoon hoon
python3 "$HERE/verify-activation-result.py" "$OUT"
