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
PHASES="${PHASES:-flow,sim,restart,retry}"   # which phases run (a later phase on the wallet the earlier ones left)
# pack 8 phases (a second fresh wallet, WHO=erin): flow2 (fund -> buy -> buy again from the
# token note's NOCK -> sell -> transfer), simq (two buys at once through the per-pool queue),
# restart2 (a crash after the broadcast, reconciled by id)
T="${TAG:-}"   # appended to the request ids of the restart and retry phases (a request id is never planned twice)   # which phases run (a later phase on the wallet the earlier ones left)
phase() { case ",$PHASES," in *",$1,"*) return 0;; *) return 1;; esac; }
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
dave_addr() { python3 -c "import json;print(json.load(open('$RUN/wallets/$WHO/identity.json'))['address'])"; }
[ -f "$RUN/wallets/$WHO/identity.json" ] && DAVE_ADDR=$(dave_addr) || DAVE_ADDR=""

if phase flow; then
step "1. a completely fresh wallet: $WHO (zero NOCK, zero tokens)"
if [ -d "$RUN/wallets/$WHO" ]; then echo "SKIP	$WHO exists (RESUME)"; run created balances "$WHO"; else run created create "$WHO" || exit 1; fi
DAVE_ADDR=$(dave_addr); echo "ADDRESS	$WHO	$DAVE_ADDR"

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
fi

if phase sim; then
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
fi

if phase restart; then
step "7. a restart during submission"
run fund4 pay alice "$DAVE_ADDR" "$FUND" --request-id "fund-$WHO-4$T" || exit 1
echo "-- 7a. crash after the reservation (nothing built, nothing sent): the restart aborts it and releases the inputs"
$CLI buy "$WHO" "$BUY" --request-id "crash-reserved$T" --crash-after reserved 2>&1 | tee "$S/crash-reserved.txt"
run crash-reserved-balances balances "$WHO" | grep -E "^BALANCES|OPEN"
run crash-reserved-reconcile reconcile "$WHO"
echo "-- 7b. crash after the build (a signed transaction on disk with its id, never sent): the restart sends it"
$CLI buy "$WHO" "$BUY" --request-id "crash-built$T" --crash-after built 2>&1 | tee "$S/crash-built.txt"
run crash-built-reconcile reconcile "$WHO"
run crash-built-wait wait "$WHO" "crash-built$T"
run crash-built-status status "$WHO" | grep "crash-built$T"
echo "-- 7c. crash after the broadcast, before the record of it: the restart finds the transaction by its id"
run fund5 pay alice "$DAVE_ADDR" "$FUND" --request-id "fund-$WHO-5$T" || exit 1
$CLI buy "$WHO" "$BUY" --request-id "crash-broadcast$T" --crash-after broadcast 2>&1 | tee "$S/crash-broadcast.txt"
run crash-broadcast-balances balances "$WHO" | grep -E "^BALANCES|OPEN"
run crash-broadcast-reconcile reconcile "$WHO"
run crash-broadcast-wait wait "$WHO" "crash-broadcast$T"
fi

if phase retry; then
step "8. a refused simultaneous trade is retried: a new request, a new quote against the pool as it is now"
run fund6 pay alice "$DAVE_ADDR" "$FUND" --request-id "fund-$WHO-6$T" || exit 1
run retry-a buy "$WHO" "$BUY" --request-id "sim-buy-retry$T" || exit 1
step "8b. two requests against ONE free plain note: the second is refused by the reservation before anything is built"
run before-onenote balances "$WHO" | grep -E "^BALANCES|NOTE.*plain"
$CLI buy "$WHO" "$BUY" --request-id "onenote-A$T" > "$S/onenote-A.txt" 2>&1 &
PA=$!
$CLI buy "$WHO" "$BUY" --request-id "onenote-B$T" > "$S/onenote-B.txt" 2>&1 &
PB=$!
wait $PA; RA=$?; wait $PB; RB=$?
echo "ONENOTE	A rc=$RA	B rc=$RB"; grep -hE "^(PLAN|BUILT|SENT|MINED|REFUSED|ABORTED|ERROR|RESULT)" "$S/onenote-A.txt" "$S/onenote-B.txt"
fi

if phase flow2; then
step "P8-1. a completely fresh wallet: $WHO (zero NOCK, zero tokens)"
if [ -d "$RUN/wallets/$WHO" ]; then echo "SKIP	$WHO exists (RESUME)"; run p8-created balances "$WHO"; else run p8-created create "$WHO" || exit 1; fi
DAVE_ADDR=$(dave_addr); echo "ADDRESS	$WHO	$DAVE_ADDR"
step "P8-2. funding: alice pays $WHO $FUND nicks"
run p8-fund pay alice "$DAVE_ADDR" "$FUND" --request-id "p8-fund-$WHO-1$T" || exit 1
run p8-funded balances "$WHO" | grep -E "^BALANCES"
step "P8-3. first buy ($BUY nicks, slippage floor 1 %)"
run p8-quote1 quote "$WHO" buy "$BUY"
run p8-buy1 buy "$WHO" "$BUY" --slippage-bps 100 --request-id "p8-buy-$WHO-1$T" || exit 1
step "P8-4. second buy with what is left: the token note's NOCK funds it, its units join the bought claim"
run p8-quote2 quote "$WHO" buy "$BUY"
run p8-buy2 buy "$WHO" "$BUY" --slippage-bps 100 --request-id "p8-buy-$WHO-2$T" || exit 1
HELD=$(tokens_of p8-buy2); echo "HELD	$WHO	$HELD tokens (one note)"
step "P8-5. sell half back ($((HELD / 2)) tokens, slippage floor 1 %)"
run p8-sell sell "$WHO" "$((HELD / 2))" --slippage-bps 100 --request-id "p8-sell-$WHO-1$T" || exit 1
step "P8-6. transfer $XFER tokens to bob"
run p8-xfer transfer "$WHO" "$XFER" "$BOB_ADDR" --request-id "p8-xfer-$WHO-1$T" || exit 1
run p8-bob-after balances bob | grep -E "^BALANCES"
fi

if phase simq; then
step "P8-7. two buys at once through the per-pool queue: the second waits for the first to be mined and is quoted against the pool as it stands"
run p8-fund2 pay alice "$DAVE_ADDR" "$FUND" --request-id "p8-fund-$WHO-2$T" || exit 1
run p8-fund3 pay alice "$DAVE_ADDR" "$FUND" --request-id "p8-fund-$WHO-3$T" || exit 1
run p8-before-simq balances "$WHO" | grep -E "^BALANCES|NOTE.*plain"
# SIMQ_SLIP: the pair's slippage allowance in bps (300: the second is refused by its floor
# after the first moves the pool ~7 %; 1000: the second goes through on a fresh quote)
$CLI buy "$WHO" "$BUY" --slippage-bps "${SIMQ_SLIP:-300}" --request-id "p8-simq-A$T" > "$S/p8-simq-A$T.txt" 2>&1 &
PA=$!
$CLI buy "$WHO" "$BUY" --slippage-bps "${SIMQ_SLIP:-300}" --request-id "p8-simq-B$T" > "$S/p8-simq-B$T.txt" 2>&1 &
PB=$!
wait $PA; RA=$?; wait $PB; RB=$?
echo "SIMQ	A rc=$RA	B rc=$RB"; grep -hE "^(FLOOR|PLAN|QUEUE|BUILT|SENT|MINED|REFUSED|ABORTED|ERROR|RESULT)" "$S/p8-simq-A$T.txt" "$S/p8-simq-B$T.txt"
run p8-after-simq balances "$WHO" | grep -E "^BALANCES"
step "P8-7b. a floor the pool cannot meet: refused before the build, nothing reserved afterwards"
run p8-floor buy "$WHO" "$BUY" --min-out 999999999 --request-id "p8-floor$T"
run p8-after-floor balances "$WHO" | grep -E "^BALANCES"
fi

if phase restart2; then
step "P8-8. a restart after the broadcast, reconciled by transaction id"
$CLI buy "$WHO" "$BUY" --request-id "p8-crash-broadcast$T" --crash-after broadcast 2>&1 | tee "$S/p8-crash-broadcast.txt"
run p8-crash-balances balances "$WHO" | grep -E "^BALANCES|OPEN"
run p8-crash-reconcile reconcile "$WHO"
run p8-crash-wait wait "$WHO" "p8-crash-broadcast$T"
fi

run final balances "$WHO"
run final-status status "$WHO"
echo "#### backend demo complete"
