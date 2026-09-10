#!/usr/bin/env bash
# Start a fakenet Nockchain node under a constrained memory budget.
#
# The verifier-setup build is rayon-parallel and its peak RSS is dominated by
# per-thread prover buffers. On a 13.34 GiB cgroup the default 4-thread build
# was OOM-killed at 13.24 GiB; pinning rayon to one thread peaks at 2.85 GiB.
# It is slower, and it fits.
#
# Both settings are documented operator knobs:
#   RAYON_NUM_THREADS         prover parallelism
#   AI_POW_VERIFIER_CACHE_CAP resident-context LRU cap (ai-pow-jets/src/setup.rs:692)
#
# Usage: node-lowmem.sh <nockchain-repo> <run-dir> [private-grpc-port]
set -euo pipefail
REPO="${1:?usage: node-lowmem.sh <nockchain-repo> <run-dir> [port]}"
RUN="${2:?usage: node-lowmem.sh <nockchain-repo> <run-dir> [port]}"
PORT="${3:-25655}"
THREADS="${RAYON_NUM_THREADS:-1}"

mkdir -p "$RUN/data"
echo "[node] repo=$REPO run=$RUN port=$PORT rayon_threads=$THREADS"
echo "[node] first boot generates the 14-bucket verifier-setup table; this is"
echo "[node] a one-time cost, cached under the data dir."

RAYON_NUM_THREADS="$THREADS" AI_POW_VERIFIER_CACHE_CAP="${AI_POW_VERIFIER_CACHE_CAP:-1}" \
RUST_LOG="${RUST_LOG:-info}" \
  "$REPO/target/release/nockchain" \
  --fakenet --data-dir "$RUN/data" \
  --bind-private-grpc-port "$PORT" \
  --fakenet-pow-len "${FAKENET_POW_LEN:-2}" \
  --fakenet-log-difficulty "${FAKENET_LOG_DIFF:-1}" \
  --no-default-peers --bind /ip4/127.0.0.1/udp/0/quic-v1 \
  >"$RUN/node.log" 2>&1 &

echo "$!" > "$RUN/node.pid"
echo "[node] pid=$(cat "$RUN/node.pid"); log=$RUN/node.log"
echo "[node] wait for readiness with:  grep -a 'handle-command: born' $RUN/node.log"
