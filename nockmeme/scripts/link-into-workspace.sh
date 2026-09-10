#!/usr/bin/env bash
# Wire the nmeme crates into a Nockchain checkout so they build against the
# real nockchain-types and nockchain-math and share its compiled dependency
# graph. Idempotent.
#
# Usage: link-into-workspace.sh <nockchain-checkout>
set -euo pipefail
REPO="${1:?usage: link-into-workspace.sh <nockchain-checkout>}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ -f "$REPO/Cargo.toml" ] || { echo "not a cargo workspace: $REPO" >&2; exit 1; }
for c in nmeme-core nmeme-tx nmeme-index; do
  ln -sfn "$HERE/crates/$c" "$REPO/crates/$c"
  grep -q "\"crates/$c\"" "$REPO/Cargo.toml" \
    || sed -i "s|\"crates/nockchain-api\",|\"crates/nockchain-api\", \"crates/$c\",|" "$REPO/Cargo.toml"
  echo "linked $c"
done
grep -o '"crates/nmeme-[a-z]*"' "$REPO/Cargo.toml"
