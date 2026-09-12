#!/usr/bin/env bash
# The wallet backend (backend/) on the fakenet: a completely fresh wallet
# from zero NOCK and zero tokens through create → fund → buy → sell →
# transfer, then simultaneous requests from one wallet, then a restart in
# the middle of a submission (a crash after the reservation, after the
# build, and after the broadcast), each reconciled by transaction id.
# Every step prints the request's plan, the transaction id, the node's
# answer, the canonical block, and the balances (total / available /
# pending / attached NOCK; tokens) before and after.
#
# Runs on the chain the earlier suites left (the main pool of TOKEN_B).
# Env: REPO RUN PORT PUBLIC_ADDR TOKEN_B FEE_BPS LORE_BPS LORE_LOCK
#      PLACEHOLDER_ADDR (alice's address) MINING_PKH FEE_NICKS DUST
set -uo pipefail
REPO="${REPO:?}"; RUN="${RUN:?}"; PORT="${PORT:-25655}"; export PUBLIC_ADDR="${PUBLIC_ADDR:-127.0.0.1:5556}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; CLI="python3 $HERE/../backend/cli.py"
S="$RUN/backend"; mkdir -p "$S"
WHO="${WHO:-dave}"; FUND="${FUND_NICKS:-2000000}"; BUY="${BUY_NICKS:-655360}"; XFER="${XFER:-100}"
export FEE_BPS="${FEE_BPS:-100}" LORE_BPS="${LORE_BPS:-50}" FEE_NICKS="${FEE_NICKS:-16384}" DUST="${DUST:-1000}"
MINER="$REPO/target/release/zk-pow-mine"
"$MINER" --node-addr "http://127.0.0.1:$PORT" --mining-pkh "${MINING_PKH:?}" --num-threads 1 >"$RUN/miner.log" 2>&1 &
MINER_PID=$!; trap 'kill "$MINER_PID" 2>/dev/null || true' EXIT
step() { echo; echo "== $* =="; }
run() { # run <label> <cli args...>: output kept under $S/<label>.txt and echoed
  local label="$1"; shift
  $CLI "$@" 2>&1 | tee "$S/$label.txt"
  return "${PIPESTATUS[0]}"
}
field() { grep -oE "$2=[^	 ]+" "$S/$1.txt" | head -1 | cut -d= -f2; }
tokens_of() { grep -oE "tokens=[^:]+:total=[0-9]+" "$S/$1.txt" | tail -1 | grep -oE "[0-9]+$"; }

step "0. the pool and the funder"
run alice-before balances alice | grep -E "^BALANCES" || exit 1
ALICE_ADDR="${PLACEHOLDER_ADDR:?}"
run bob-before balances bob | grep -E "^BALANCES" || exit 1
BOB_ADDR=$(python3 -c "import json;print(json.load(open('$RUN/wallets/bob/identity.json'))['address'])")
echo "BOB	address=$BOB_ADDR"

step "1. a completely fresh wallet: $WHO (zero NOCK, zero tokens)"
if [ -d "$RUN/wallets/$WHO" ]; then echo "SKIP	$WHO exists (RESUME)"; run created balances "$WHO"; else run created create "$WHO" || exit 1; fi
DAVE_ADDR=$(python3 -c "import json;print(json.load(open('$RUN/wallets/$WHO/identity.json'))['address'])")
echo "ADDRESS	$WHO	$DAVE_ADDR"

step "2. funding: alice pays $WHO $FUND nicks (a plain payment through the backend)"
run fund pay alice "$DAVE_ADDR" "$FUND" --request-id "fund-$WHO-1" || exit 1
run funded balances "$WHO" | grep -E "^BALANCES"

step "3. buy from the main pool with $BUY nicks"
run buy buy "$WHO" "$BUY" --request-id "buy-$WHO-1" || exit 1
HELD=$(tokens_of buy); echo "HELD	$WHO	$HELD tokens"

step "4. sell half back ($((HELD / 2)) tokens): the token note's own NOCK pays the fee, the change claim keeps the rest"
run sell sell "$WHO" "$((HELD / 2))" --request-id "sell-$WHO-1" || exit 1

step "5. transfer $XFER tokens to bob"
run xfer transfer "$WHO" "$XFER" "$BOB_ADDR" --request-id "xfer-$WHO-1" || exit 1
run bob-after balances bob | grep -E "^BALANCES"
run status-after-flow status "$WHO"

step "6. simultaneous requests: two buys at once from one wallet holding two plain notes"
run fund2a pay alice "$DAVE_ADDR" "$FUND" --request-id "fund-$WHO-2a" || exit 1
run fund2b pay alice "$DAVE_ADDR" "$((FUND / 2))" --request-id "fund-$WHO-2b" || exit 1
run before-sim balances "$WHO" | grep -E "^BALANCES|NOTE.*plain"
$CLI buy "$WHO" "$BUY" --request-id "sim-buy-A" > "$S/sim-A.txt" 2>&1 &
PA=$!
$CLI buy "$WHO" "$BUY" --request-id "sim-buy-B" > "$S/sim-B.txt" 2>&1 &
PB=$!
wait $PA; RA=$?; wait $PB; RB=$?
echo "SIM	A rc=$RA	B rc=$RB"; grep -hE "^(PLAN|BUILT|SENT|MINED|REFUSED|ABORTED|ERROR|RESULT)" "$S/sim-A.txt" "$S/sim-B.txt"
run after-sim balances "$WHO" | grep -E "^BALANCES"
step "6b. simultaneous requests against ONE plain note: the second must be refused by the reservation, not by the node"
run fund3 pay alice "$DAVE_ADDR" "$FUND" --request-id "fund-$WHO-3" || exit 1
$CLI buy "$WHO" "$BUY" --request-id "sim2-buy-A" > "$S/sim2-A.txt" 2>&1 &
PA=$!
$CLI buy "$WHO" "$BUY" --request-id "sim2-buy-B" > "$S/sim2-B.txt" 2>&1 &
PB=$!
wait $PA; RA=$?; wait $PB; RB=$?
echo "SIM2	A rc=$RA	B rc=$RB"; grep -hE "^(PLAN|BUILT|SENT|MINED|REFUSED|ABORTED|ERROR|RESULT)" "$S/sim2-A.txt" "$S/sim2-B.txt"

step "7. a restart during submission"
run fund4 pay alice "$DAVE_ADDR" "$FUND" --request-id "fund-$WHO-4" || exit 1
echo "-- 7a. crash after the reservation (nothing built, nothing sent): the restart aborts it and releases the inputs"
$CLI buy "$WHO" "$BUY" --request-id "crash-reserved" --crash-after reserved 2>&1 | tee "$S/crash-reserved.txt"
run crash-reserved-balances balances "$WHO" | grep -E "^BALANCES|OPEN"
run crash-reserved-reconcile reconcile "$WHO"
echo "-- 7b. crash after the build (a signed transaction on disk with its id, never sent): the restart sends it"
$CLI buy "$WHO" "$BUY" --request-id "crash-built" --crash-after built 2>&1 | tee "$S/crash-built.txt"
run crash-built-reconcile reconcile "$WHO"
run crash-built-wait wait "$WHO" crash-built
echo "-- 7c. crash after the broadcast, before the record of it: the restart finds the transaction by its id"
run fund5 pay alice "$DAVE_ADDR" "$FUND" --request-id "fund-$WHO-5" || exit 1
$CLI buy "$WHO" "$BUY" --request-id "crash-broadcast" --crash-after broadcast 2>&1 | tee "$S/crash-broadcast.txt"
run crash-broadcast-balances balances "$WHO" | grep -E "^BALANCES|OPEN"
run crash-broadcast-reconcile reconcile "$WHO"
run crash-broadcast-wait wait "$WHO" crash-broadcast
run final balances "$WHO"
run final-status status "$WHO"
echo "#### backend demo complete"
