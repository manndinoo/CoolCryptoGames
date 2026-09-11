#!/usr/bin/env bash
# Start a fakenet Nockchain node under a constrained memory budget.
#
# First-boot GENERATION of the verifier-setup seed cache does not fit here at
# any thread count (measured: 38 GB and climbing at 4 threads, >13 GB at 1;
# results/environment.md). Install a cache produced elsewhere first
# (install-seed-cache.sh); with it present the node only REBUILDS contexts
# from seeds and writes them to disk, which is the phase this script is for.
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
# The public gRPC service is OFF by default, and it is the only one exposing
# WalletGetBalance — which is how balances are rebuilt from note-data. Bind it
# from the start; adding it later means restarting the node.
PUBLIC_ADDR="${PUBLIC_ADDR:-127.0.0.1:5556}"
THREADS="${RAYON_NUM_THREADS:-1}"

mkdir -p "$RUN/data"
echo "[node] repo=$REPO run=$RUN private=$PORT public=$PUBLIC_ADDR rayon_threads=$THREADS"
echo "[node] first boot generates the 14-bucket verifier-setup table; this is"
echo "[node] a one-time cost, cached under the data dir. Reusing the same"
echo "[node] --data-dir on a later boot skips it (ai-pow-jets/src/setup.rs:751)."

RAYON_NUM_THREADS="$THREADS" AI_POW_VERIFIER_CACHE_CAP="${AI_POW_VERIFIER_CACHE_CAP:-1}" \
RUST_LOG="${RUST_LOG:-info}" \
  "$REPO/target/release/nockchain" \
  --fakenet --data-dir "$RUN/data" \
  --bind-private-grpc-port "$PORT" \
  --bind-public-grpc-addr "$PUBLIC_ADDR" \
  --fakenet-pow-len "${FAKENET_POW_LEN:-2}" \
  --fakenet-log-difficulty "${FAKENET_LOG_DIFF:-1}" \
  --no-default-peers --bind /ip4/127.0.0.1/udp/0/quic-v1 \
  >"$RUN/node.log" 2>&1 &

echo "$!" > "$RUN/node.pid"
echo "[node] pid=$(cat "$RUN/node.pid"); log=$RUN/node.log"
echo "[node] wait for readiness with:  grep -a 'handle-command: born' $RUN/node.log"
