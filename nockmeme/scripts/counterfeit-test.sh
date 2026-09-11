#!/usr/bin/env bash
# The counterfeit-input test (review pack 4, point 1).
#
#   1  an ordinary transaction carrying a fabricated transfer claim for an
#      existing token, consuming no tokens: does consensus mine it?
#   2  that note sold into the token's real pool: does the covenant pay NOCK?
#   3  the indexer's verdict on the same history.
#
# Before the fix the expected answers were yes, yes, refused: the covenant
# counted claims consensus never validated. After the fix, step 1 must be
# refused by the node (the note never exists) and step 2 cannot be built.
# Output lines: COUNTERFEIT-CREATE, COUNTERFEIT-SELL, INDEXER.
set -euo pipefail
REPO="${REPO:?}"; RUN="${RUN:?}"; PORT="${PORT:-25655}"; PUB="${PUBLIC_ADDR:-127.0.0.1:5556}"
WALLET="$REPO/target/release/nockchain-wallet"
NMEME_TX="${NMEME_TX:-$REPO/target/release/nmeme-tx}"
NMEME_INDEX="${NMEME_INDEX:-$REPO/target/release/nmeme-index}"
MINER="$REPO/target/release/zk-pow-mine"
W="$RUN/wallets"; S="$RUN/counterfeit"; mkdir -p "$S"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/lib-verify.sh"; . "$HERE/lib-mine.sh"; . "$HERE/lib-tx.sh"
TOKEN="${TOKEN:?the token with a live pool}"; FEE_BPS="${FEE_BPS:-100}"; LORE_BPS="${LORE_BPS:-50}"; LORE_LOCK="${LORE_LOCK:-}"
ALICE_LOCK="${ALICE_LOCK:?}"; BOB_LOCK="${BOB_LOCK:?}"; ALICE_FIRSTS="${ALICE_FIRSTS:?}"
FAKE="${FAKE:-500000}"; SELL="${SELL:-400000}"; DUST="${DUST:-1000}"
export NMEME_FEE_HEIGHT="${NMEME_FEE_HEIGHT:-1}"
PP="--lore-bps $LORE_BPS --lore-lock ${LORE_LOCK:-$ALICE_LOCK}"
ALICE=$(wallet alice list-active-addresses | strip | grep -oE '^- Address: .*' | head -1 | sed 's/^- Address: //')
BOB=$(wallet bob list-active-addresses | strip | grep -oE '^- Address: .*' | head -1 | sed 's/^- Address: //')
"$MINER" --node-addr "http://127.0.0.1:$PORT" --mining-pkh "$ALICE" --num-threads 1 >"$RUN/miner.log" 2>&1 &
MINER_PID=$!; trap 'kill "$MINER_PID" 2>/dev/null || true' EXIT
for who in alice bob; do wallet "$who" list-notes >/dev/null 2>&1 || true; done

echo "== 1. a note with a fabricated claim of $FAKE of token $TOKEN, from a coinbase note =="
f=$(echo "$ALICE_FIRSTS" | awk '{print $1}')
quiet "$NMEME_INDEX" funding --addr "$PUB" --first "$f" > "$S/funding.txt" || die "funding read"
cb=$(awk -F'\t' '$1=="FUNDING" && $4=="coinbase" && $5+0>=200000 {print $2" "$3; exit}' "$S/funding.txt"); [ -n "$cb" ] || die "no coinbase note"
tx=$(create_tx alice "$S/create" "[$cb]" "$BOB" 100000)
quiet "$NMEME_INDEX" check-inputs --addr "$PUB" --tx "$tx" > "$S/create/check-inputs.txt" 2>&1 || die "gate"
"$NMEME_TX" sighash "$tx" "$S/create" > "$S/create/sighash.txt" || die "sighash"; verify_all alice "$S/create/sighash.txt" "create-wallet"
# the fabricated claim: a transfer claim of an existing token on a payment that consumed none
"$NMEME_TX" attach "$tx" "$S/create/attached.jam" "$BOB_LOCK=transfer:$TOKEN:$FAKE" > "$S/create/attach.txt" || die "attach: $(tail -1 "$S/create/attach.txt")"
resign alice "$S/create/sighash.txt" "$S/create/attached.jam" "$S/create/attach.txt" "$S/create/final.jam"
CTX=$("$NMEME_INDEX" tx-id --tx "$S/create/final.jam"); sent=$(send "$S/create/final.jam" create)
sed 's/^/  node: /' "$S/send-create.txt" >&2
h0=$(node_height); wait_for_height "$RUN/node.log" $((h0 + 2)) "${MINE_TIMEOUT:-900}" >/dev/null
if unspent "${cb%% *}" "${cb##* }"; then
  engine=$(strip < "$RUN/node.log" | grep -a -A2 "heard-new-tx: Miner received new transaction: $CTX" | grep -a -o -m1 "tx-acc: process failed: [a-z0-9-]*" || true)
  echo "COUNTERFEIT-CREATE	refused	txid=$CTX	mempool=$(awk -F'\t' '$1=="MEMPOOL"{print $2}' "$S/send-create.txt")	engine=${engine#tx-acc: process failed: }	(the note with the fabricated claim does not exist)"
  echo "COUNTERFEIT-SELL	not attempted: there is no counterfeit note to sell"
  exit 0
fi
FAKE_NOTE=$("$NMEME_INDEX" outputs --tx "$S/create/final.jam" | awk -F'\t' -v l="$BOB_LOCK" '$1=="OUTPUT" && $2==l {print $3" "$4; exit}')
echo "COUNTERFEIT-CREATE	MINED	txid=$CTX	height=$(node_height)	note=[$FAKE_NOTE]	claim=$FAKE of $TOKEN, consuming no tokens (consensus accepted a claim it never validated)"

echo "== 2. sell $SELL of the fabricated tokens into the real pool =="
st=$(quiet "$NMEME_INDEX" pool --addr "$PUB" --token "$TOKEN" --fee-bps "$FEE_BPS" $PP 2>/dev/null | awk -F'\t' '$1=="POOL"{print $2" "$3" "$4" "$5" "$6; exit}'); [ -n "$st" ] || die "no pool note"
echo "POOL-BEFORE	$(cut -d' ' -f4,5 <<<"$st")"
lb0=$(quiet "$NMEME_INDEX" funding --addr "$PUB" --lock "$BOB_LOCK" 2>/dev/null | awk -F'\t' '$1=="FUNDING"{s+=$5} END{print s+0}')
btx=$(create_tx bob "$S/sell" "[$FAKE_NOTE]" "$ALICE" "$DUST")
"$NMEME_TX" sighash "$btx" "$S/sell" > "$S/sell/sighash.txt" || die "sighash"; verify_all bob "$S/sell/sighash.txt" "sell-wallet"
"$NMEME_TX" pool-trade "$btx" "$S/sell/assembled.jam" --pool "$st" --token "$TOKEN" --fee-bps "$FEE_BPS" $PP --side sell --placeholder "$ALICE_LOCK" --dust "$DUST" --tokens-in "$SELL" --claim "$BOB_LOCK=transfer:$TOKEN:$((FAKE - SELL))" > "$S/sell/trade.txt" 2>&1 || die "pool-trade: $(tail -1 "$S/sell/trade.txt")"
grep -E "^(QUOTE|POOL-)" "$S/sell/trade.txt" | sed 's/^/  /' >&2
resign bob "$S/sell/sighash.txt" "$S/sell/assembled.jam" "$S/sell/trade.txt" "$S/sell/final.jam"
STX=$("$NMEME_INDEX" tx-id --tx "$S/sell/final.jam"); sent=$(send "$S/sell/final.jam" sell)
sed 's/^/  node: /' "$S/send-sell.txt" >&2
h0=$(node_height); wait_for_height "$RUN/node.log" $((h0 + 2)) "${MINE_TIMEOUT:-900}" >/dev/null
pn=$(cut -d' ' -f1,2 <<<"$st")
if unspent "${pn%% *}" "${pn##* }"; then
  engine=$(strip < "$RUN/node.log" | grep -a -A2 "heard-new-tx: Miner received new transaction: $STX" | grep -a -o -m1 "tx-acc: process failed: [a-z0-9-]*" || true)
  echo "COUNTERFEIT-SELL	refused	txid=$STX	mempool=$(awk -F'\t' '$1=="MEMPOOL"{print $2}' "$S/send-sell.txt")	engine=${engine#tx-acc: process failed: }"
else
  st2=$(quiet "$NMEME_INDEX" pool --addr "$PUB" --token "$TOKEN" --fee-bps "$FEE_BPS" $PP 2>/dev/null | awk -F'\t' '$1=="POOL"{print $5" "$6; exit}')
  lb1=$(quiet "$NMEME_INDEX" funding --addr "$PUB" --lock "$BOB_LOCK" 2>/dev/null | awk -F'\t' '$1=="FUNDING"{s+=$5} END{print s+0}')
  echo "COUNTERFEIT-SELL	MINED	txid=$STX	height=$(node_height)	pool_after=$(tr ' ' '/' <<<"$st2")	bob_nock_before=$lb0	bob_nock_after=$lb1	(the covenant paid real NOCK for tokens that never existed)"
fi
echo "== 3. the indexer on the same history =="
"$NMEME_INDEX" outputs --tx "$S/create/final.jam" > "$S/create/outputs.txt" || true
set +e
"$NMEME_INDEX" rebuild --addr "$PUB" --token "$TOKEN" --step "$CTX:$S/create/final.jam" --scan-coinbase "$(node_height)" --lock "$BOB_LOCK" > "$S/indexer.txt" 2>&1; rc=$?
set -e
echo "INDEXER	rc=$rc	$(grep -E '^(STEP|error)' "$S/indexer.txt" | tail -2 | tr '\n' ' ' | cut -c1-200)"
