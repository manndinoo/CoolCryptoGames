#!/usr/bin/env bash
# Live NMEME demonstration on a local fakenet chain.
#
# Stages, in order, because each depends on the last:
#   1  two fresh wallets, isolated by NOCKAPP_HOME
#   2  mine to Alice until she has a spendable note
#   3  build an ordinary transaction with the wallet
#   4  GATE: verify the Rust sig-hash against the wallet's own signature
#   5  attach a token claim, re-sign, broadcast
#   6  rebuild balances from the chain
#
# Stage 4 is a gate, not a formality. If the Rust digest disagrees with the
# wallet's, everything after it produces signatures a node rejects for reasons
# that read like fee or networking faults. Nothing proceeds past a failed gate.
#
# Every wallet call pins --client private to the LOCAL node: the CLI's default
# endpoint is a public node.
set -uo pipefail

REPO="${REPO:?set REPO to the nockchain checkout}"
RUN="${RUN:?set RUN to a working directory}"
PORT="${PORT:-25655}"
WALLET="$REPO/target/release/nockchain-wallet"
NMEME_TX="$REPO/target/debug/nmeme-tx"
MINER="$REPO/target/release/zk-pow-mine"
W="$RUN/wallets"

wallet() { # wallet <name> <args...>
  local who="$1"; shift
  ( cd "$W/$who" && NOCKAPP_HOME="$W/$who" RUST_LOG=error "$WALLET" \
      --client private --private-grpc-server-port "$PORT" --fakenet "$@" )
}
strip() { sed 's/\x1b\[[0-9;]*m//g'; }

echo "== stage 1: wallets =="
mkdir -p "$W/alice" "$W/bob"
for who in alice bob; do
  [ -f "$W/$who/.done" ] || { wallet "$who" keygen >/dev/null 2>&1; touch "$W/$who/.done"; }
done
ALICE=$(wallet alice list-active-addresses 2>&1 | strip | grep -oE '^- Address: .*' | head -1 | sed 's/^- Address: //')
BOB=$(wallet bob list-active-addresses 2>&1 | strip | grep -oE '^- Address: .*' | head -1 | sed 's/^- Address: //')
echo "alice=$ALICE"
echo "bob=$BOB"
[ -n "$ALICE" ] && [ -n "$BOB" ] || { echo "FAIL: could not read wallet addresses"; exit 1; }

echo "== stage 2: mine to alice =="
"$MINER" --node-addr "http://127.0.0.1:$PORT" --mining-pkh "$ALICE" --num-threads 1 \
  >"$RUN/miner.log" 2>&1 &
echo "miner pid=$!"
# fakenet sets coinbase-timelock-min=1, so a couple of blocks is enough.
DEADLINE=$((SECONDS + ${MINE_TIMEOUT:-1200}))
while (( SECONDS < DEADLINE )); do
  HEIGHT=$(grep -ao "added to validated blocks at [0-9]*" "$RUN/node.log" 2>/dev/null | tail -1 | grep -oE '[0-9]+$')
  [ -n "${HEIGHT:-}" ] && [ "$HEIGHT" -ge "${MIN_HEIGHT:-3}" ] && break
  sleep 10
done
echo "height=${HEIGHT:-none}"
[ -n "${HEIGHT:-}" ] || { echo "FAIL: no block mined"; exit 1; }

echo "== stage 3: build an ordinary transaction =="
wallet alice list-notes 2>&1 | strip | tee "$RUN/alice-notes.txt" | head -30
NAME=$(grep -oE '\[[A-Za-z0-9]+ [A-Za-z0-9]+\]' "$RUN/alice-notes.txt" | head -1)
echo "note=$NAME"
[ -n "$NAME" ] || { echo "FAIL: alice has no notes"; exit 1; }
wallet alice create-tx --names "$NAME" \
  --recipient "{\"kind\":\"p2pkh\",\"address\":\"$ALICE\",\"amount\":${SEND_NICKS:-1000}}" \
  --fee "${FEE_NICKS:-256}" --allow-low-fee 2>&1 | strip | tee "$RUN/create-tx.txt" | tail -5
TX=$(find "$W/alice" -name '*.tx' -o -name '*.jam' | grep -i tx | head -1)
echo "tx=$TX"
[ -n "$TX" ] || { echo "FAIL: no transaction file produced"; exit 1; }

echo "== stage 4: GATE — verify the Rust sig-hash =="
"$NMEME_TX" sighash "$TX" "$RUN" | tee "$RUN/sighash.txt"
PASS=0; TOTAL=0
while IFS=$'\t' read -r tag name digest pubkey sigfile; do
  [ "$tag" = "SIGHASH" ] || continue
  TOTAL=$((TOTAL+1))
  if wallet alice verify-hash "$digest" "$sigfile" "$pubkey" 2>&1 | strip | grep -qi "valid\|true\|ok"; then
    echo "  PASS $name"; PASS=$((PASS+1))
  else
    echo "  FAIL $name — Rust digest does not match what the wallet signed"
  fi
done < "$RUN/sighash.txt"
echo "gate: $PASS/$TOTAL signatures verified"
[ "$TOTAL" -gt 0 ] && [ "$PASS" -eq "$TOTAL" ] || {
  echo "GATE FAILED — stopping. Do not attach claims to a transaction whose"
  echo "digest is unverified; the node's rejection would not tell you why."
  exit 1
}
echo "GATE PASSED"
