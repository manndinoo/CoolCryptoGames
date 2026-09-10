#!/usr/bin/env bash
# Once a first node boot has generated and cached the verifier setup, restart
# the node with the public gRPC service bound (off by default, and required by
# nmeme-index) and run the live demonstration.
#
# Usage: REPO=<nockchain> RUN=<run-dir> run-after-born.sh
#
# Safe to run only after "handle-command: born" has appeared in the first
# boot's log: before that the cache does not exist and a restart discards the
# work done so far.
set -euo pipefail
REPO="${REPO:?set REPO}"; RUN="${RUN:?set RUN}"
PORT="${PORT:-25655}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

grep -aq "handle-command: born" "$RUN/node.log" \
  || { echo "refusing: node has not reached %born; a restart now discards the setup work" >&2; exit 1; }
[ -n "$(ls -A "$RUN/data" 2>/dev/null)" ] \
  || { echo "refusing: $RUN/data is empty, so no setup cache exists to reuse" >&2; exit 1; }

echo "[restart] stopping the first-boot node"
pkill -f "nockchain --fakenet --data-dir $RUN/data" || true
sleep 3
mv "$RUN/node.log" "$RUN/node-firstboot.log"

echo "[restart] starting with public gRPC bound; setup should load from cache"
bash "$HERE/node-lowmem.sh" "$REPO" "$RUN" "$PORT"
DEADLINE=$((SECONDS + ${REBOOT_TIMEOUT:-900}))
until grep -aq "handle-command: born" "$RUN/node.log"; do
  (( SECONDS < DEADLINE )) || { echo "restart did not reach %born in time" >&2; exit 1; }
  pgrep -f "nockchain --fakenet --data-dir $RUN/data" >/dev/null || { echo "restarted node died" >&2; exit 1; }
  sleep 10
done
echo "[restart] %born after $((SECONDS))s"
grep -a "verifier-setup\|installed" "$RUN/node.log" | sed 's/\x1b\[[0-9;]*m//g' | tail -3

echo "[demo] running live-demo.sh"
REPO="$REPO" RUN="$RUN" PORT="$PORT" bash "$HERE/live-demo.sh" 2>"$RUN/demo-progress.log" | tee "$RUN/demo-results.txt"
