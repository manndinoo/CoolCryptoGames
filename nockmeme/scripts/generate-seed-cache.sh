#!/usr/bin/env bash
# Run ONCE on any machine with enough memory (~32 GB) to produce the one file
# this environment cannot: the verifier-setup seed cache.
#
# What it is: <data-dir>/ai-pow/verifier-setup-seeds-v1.bin, magic NCVPSEED
# (ai-pow-jets/src/setup.rs:519-531). Generating it is the FRI-proving phase
# that was OOM-killed at ~13.9 GB here. Rebuilding contexts FROM it is
# "circuit compile + Merkle commit; seconds, no FRI proving" (setup.rs:497),
# and every rebuilt context is checked against a consensus-committed digest on
# load, so a file from any machine either validates or is refused.
#
# The seed set is production_verifier_setup_buckets(): consensus-fixed, not a
# function of fakenet parameters, so it does not matter what --fakenet-* flags
# the generating node ran with.
#
# Usage: generate-seed-cache.sh <nockchain-repo-with-built-binaries> <scratch-dir>
# Output: <scratch-dir>/nmeme-seed-cache.tar.gz  (+ .sha256)
set -euo pipefail
REPO="${1:?usage: generate-seed-cache.sh <nockchain-repo> <scratch-dir>}"
RUN="${2:?usage: generate-seed-cache.sh <nockchain-repo> <scratch-dir>}"
[ -x "$REPO/target/release/nockchain" ] || { echo "build nockchain first (see RUNBOOK.md step 3)" >&2; exit 1; }
mkdir -p "$RUN/data"
SEED="$RUN/data/ai-pow/verifier-setup-seeds-v1.bin"

echo "[gen] starting node; this is the ~15 min (4 threads) / multi-GB phase"
RUST_LOG=info "$REPO/target/release/nockchain" --fakenet --data-dir "$RUN/data" \
  --bind-private-grpc-port 25655 --no-default-peers \
  --bind /ip4/127.0.0.1/udp/0/quic-v1 >"$RUN/node.log" 2>&1 &
PID=$!; trap 'kill $PID 2>/dev/null || true' EXIT

DEADLINE=$((SECONDS + ${GEN_TIMEOUT:-5400}))
until grep -aq "handle-command: born" "$RUN/node.log"; do
  kill -0 $PID 2>/dev/null || { echo "[gen] node died; check $RUN/node.log and dmesg for an OOM kill" >&2; exit 1; }
  (( SECONDS < DEADLINE )) || { echo "[gen] timed out" >&2; exit 1; }
  sleep 30
done
echo "[gen] %born after ${SECONDS}s"
kill $PID 2>/dev/null || true; wait $PID 2>/dev/null || true

[ -s "$SEED" ] || { echo "[gen] node was born but $SEED is missing" >&2; exit 1; }
[ "$(head -c 8 "$SEED")" = "NCVPSEED" ] || { echo "[gen] $SEED lacks the NCVPSEED magic" >&2; exit 1; }
SIZE=$(stat -c %s "$SEED"); SHA=$(sha256sum "$SEED" | cut -d' ' -f1)
tar -C "$RUN/data" -czf "$RUN/nmeme-seed-cache.tar.gz" ai-pow/verifier-setup-seeds-v1.bin
{ echo "file:     ai-pow/verifier-setup-seeds-v1.bin"; echo "sha256:   $SHA"; echo "bytes:    $SIZE"
  echo "revision: 2bcb0b9dfd190f17252205afd1c8a067048a1ad9"; echo "made:     $(date -u '+%Y-%m-%d %H:%M UTC')"
  echo "host:     $(uname -m) $(nproc) cores, $(awk '/MemTotal/{printf "%.1f GiB", $2/1048576}' /proc/meminfo)"
} | tee "$RUN/nmeme-seed-cache.sha256"
echo "[gen] send back: $RUN/nmeme-seed-cache.tar.gz and $RUN/nmeme-seed-cache.sha256"
