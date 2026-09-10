# Waiting for the chain to reach a height, factored out so it can be tested
# with a mocked clock and a mocked node log.
#
# An earlier version's post-loop check only required that SOME height had
# parsed, not that it reached MIN_HEIGHT. A node stuck at height 1 with
# MIN_HEIGHT=3 therefore proceeded after the deadline as if mining had
# succeeded. Independently reproduced; fixed here.

# wait_for_height <node.log> <min-height> <timeout-seconds>
# Prints the height reached on success. Returns 1 with a reason on stderr if
# no block was seen, or if the best height seen is below the minimum when the
# deadline expires.
wait_for_height() {
  local log="$1" min="$2" timeout="$3"
  local height="" deadline=$((SECONDS + timeout))
  while (( SECONDS < deadline )); do
    height=$(grep -ao "added to validated blocks at [0-9]*" "$log" 2>/dev/null \
             | tail -1 | grep -oE '[0-9]+$' || true)
    if [ -n "$height" ] && [ "$height" -ge "$min" ]; then
      echo "$height"
      return 0
    fi
    sleep 10
  done
  if [ -z "$height" ]; then
    echo "no block mined within ${timeout}s" >&2
  else
    echo "chain reached height $height but not the required $min within ${timeout}s" >&2
  fi
  return 1
}
