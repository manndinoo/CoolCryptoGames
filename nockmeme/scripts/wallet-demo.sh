#!/usr/bin/env bash
# A new wallet's whole flow on fakenet (review of pack 5, point 5): a wallet
# is created, funded with NOCK, buys from the main pool, sells part back,
# and transfers tokens to another wallet. Every step prints its transaction
# id, the block it was found in, and the balances before and after, read
# from the node through the indexer (NOCK in plain notes at the wallet's
# lock; tokens by the indexer's live view of its notes). The wallet-backend
# rules of lib-wallet.sh apply throughout: funds come from plain notes only,
# a token spend carries its change claim, sent inputs are reserved until
# mined, the fee is checked before sending.
#
# Runs after pool-suite.sh (the main pool of TOKEN_B exists) on the same
# chain. Output lines: WALLET, FUND, BUY, SELL, TRANSFER, BALANCES, PENDING.
set -euo pipefail
REPO="${REPO:?}"; RUN="${RUN:?}"; PORT="${PORT:-25655}"; PUB="${PUBLIC_ADDR:-127.0.0.1:5556}"
WALLET="$REPO/target/release/nockchain-wallet"
NMEME_TX="${NMEME_TX:-$REPO/target/release/nmeme-tx}"
NMEME_INDEX="${NMEME_INDEX:-$REPO/target/release/nmeme-index}"
MINER="$REPO/target/release/zk-pow-mine"
W="$RUN/wallets"; S="$RUN/walletdemo"; mkdir -p "$S"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/lib-verify.sh"; . "$HERE/lib-mine.sh"; . "$HERE/lib-tx.sh"; . "$HERE/lib-wallet.sh"
TOKEN_B="${TOKEN_B:?the token of the main pool}"; FEE_BPS="${FEE_BPS:-100}"
LORE_BPS="${LORE_BPS:-50}"; LORE_LOCK="${LORE_LOCK:?the lock root of the Lore Wallet}"
ALICE_LOCK="${ALICE_LOCK:?}"; BOB_LOCK="${BOB_LOCK:?}"; ALICE_FIRSTS="${ALICE_FIRSTS:?}"
DUST="${DUST:-1000}"; BUY_NICKS="${BUY_NICKS:-655360}"; FUND_NICKS="${FUND_NICKS:-2000000}"; XFER="${XFER:-100}"
export NMEME_FEE_HEIGHT="${NMEME_FEE_HEIGHT:-1}"
PP="--lore-bps $LORE_BPS --lore-lock $LORE_LOCK"
WHO="${WHO:-carol}"
ALICE=$(wallet alice list-master-addresses | strip | grep -oE '^- Address: [A-Za-z0-9]+' | head -1 | sed 's/^- Address: //')
BOB=$(wallet bob list-master-addresses | strip | grep -oE '^- Address: [A-Za-z0-9]+' | head -1 | sed 's/^- Address: //')
[ -n "$ALICE" ] && [ -n "$BOB" ] || die "wallet addresses"
"$MINER" --node-addr "http://127.0.0.1:$PORT" --mining-pkh "$ALICE" --num-threads 1 >"$RUN/miner.log" 2>&1 &
MINER_PID=$!; trap 'kill "$MINER_PID" 2>/dev/null || true' EXIT
for who in alice bob; do wallet "$who" list-notes >/dev/null 2>&1 || true; done
pool_state() { quiet "$NMEME_INDEX" pool --addr "$PUB" --token "$1" --fee-bps "$2" $PP 2>/dev/null | awk -F'\t' '$1=="POOL"{print $2" "$3" "$4" "$5" "$6}'; }
# (a lock holding none of the token makes the indexer exit non-zero: that is
# a balance of zero here, not an error, hence the `|| true` under pipefail)
tokens_at() { { quiet "$NMEME_INDEX" token-note --addr "$PUB" --lock "$1" --token "$2" 2>/dev/null || true; } | awk -F'\t' '$1=="NOTE"{s+=$4} END{print s+0}'; }
token_note_at() { { quiet "$NMEME_INDEX" token-note --addr "$PUB" --lock "$1" --token "$2" 2>/dev/null || true; } | awk -F'\t' '$1=="NOTE" {gsub(/[][]/,"",$2); print $4" "$2}' | sort -rn | head -1 | awk '{print $2" "$3" "$1}'; }
nock_at() { quiet "$NMEME_INDEX" funding --addr "$PUB" --lock "$1" 2>/dev/null | awk -F'\t' '$1=="FUNDING" && ($4=="plain"||$4=="coinbase") {s+=$5} END{print s+0}'; }
balances() { echo "BALANCES	$1	${WHO}_nock=$(nock_at "$MY_LOCK")	${WHO}_tokens=$(tokens_at "$MY_LOCK" "$TOKEN_B")	bob_tokens=$(tokens_at "$BOB_LOCK" "$TOKEN_B")	pool=$(pool_state "$TOKEN_B" "$FEE_BPS" | cut -d' ' -f4,5 | tr ' ' '/')"; }
prepared() { # <who> <label> <names> <to> <amount> [token-note] -> "<file> <sighash>"
  local who="$1" d="$S/$2"; mkdir -p "$d"
  local tx; tx=$(create_tx "$who" "$d" "$3" "$4" "$5")
  quiet "$NMEME_INDEX" check-inputs --addr "$PUB" --tx "$tx" ${6:+--token-note "$6"} > "$d/check-inputs.txt" 2>&1 || die "$2: input gate refused (see $d/check-inputs.txt)"
  "$NMEME_TX" sighash "$tx" "$d" > "$d/sighash.txt" || die "$2: sighash"; verify_all "$who" "$d/sighash.txt" "$2-wallet"
  echo "$tx $d/sighash.txt"
}
# send_tracked <who> <label> <file>: fee checked, sent, inputs reserved, confirmed, released
send_tracked() {
  local who="$1" label="$2" file="$3"
  TXID=$("$NMEME_INDEX" tx-id --tx "$file")
  local inputs; inputs=$("$NMEME_INDEX" outputs --tx "$file" | awk -F'\t' '$1=="INPUT"{print $2" "$3}')
  local sent; sent=$(send "$file" "$label"); [ "$sent" = "$TXID" ] || die "$label: send (see $S/send-$label.txt)"
  if ! grep -q "MEMPOOL	admitted" "$S/send-$label.txt"; then w_release "$who" "$TXID"; die "$label: not admitted: $(cat "$S/send-$label.txt")"; fi
  local h0; h0=$(node_height)
  while read -r n; do w_reserve "$who" "$TXID" "$label" "$h0" "$n"; done <<<"$inputs"
  echo "PENDING	$label	txid=$TXID	sent_at=$h0	reserved:$(w_reserved "$who" | tr '\n' ' ' | sed 's/ $//' | sed 's/\([^ ]*\) \([^ ]*\)/[\1 \2]/g')"
  confirm "$TXID" "$label" "$file"
  w_reconcile "$who" | sed "s/^/  ledger: /" >&2
  HEIGHT=$(cut -d= -f2 "$S/$label.env")
}

echo "== 1. a new wallet: $WHO =="
if [ ! -f "$W/$WHO/.done" ]; then
  mkdir -p "$W/$WHO" "$RUN/keys"; wallet "$WHO" keygen >/dev/null 2>&1 || die "keygen failed for $WHO"
  ( cd "$W/$WHO" && wallet "$WHO" export-keys >/dev/null 2>&1 ) || true
  [ -s "$W/$WHO/keys.export" ] || die "$WHO: keygen left no keys.export"
  cp "$W/$WHO/keys.export" "$RUN/keys/$WHO.export"; touch "$W/$WHO/.done"
fi
# a wallet whose arena was thrown away (disk) still has its keys
[ -d "$W/$WHO/wallet" ] || wallet_fresh "$WHO"
MY=$(wallet "$WHO" list-master-addresses | strip | grep -oE '^- Address: [A-Za-z0-9]+' | head -1 | sed 's/^- Address: //'); [ -n "$MY" ] || die "$WHO: address"
# the lock root: read from a throwaway transaction paying the address (its
# smallest seed is the payment), never sent
# (from a named coinbase note: left to itself the wallet's planner picks the
# smallest notes first, and alice's lock holds many 1,000-nick dust notes from
# trades, which cannot pay the fee: "Insufficient funds to pay fee and gift")
mkdir -p "$S/probe"; list_tx_files alice > "$S/probe/before.txt"
f=$(echo "$ALICE_FIRSTS" | awk '{print $1}'); quiet "$NMEME_INDEX" funding --addr "$PUB" --first "$f" > "$S/probe/funding.txt" || die "funding read"
pcb=$(awk -F'\t' '$1=="FUNDING" && $4=="coinbase" && $5+0>=100000 {print $2" "$3; exit}' "$S/probe/funding.txt"); [ -n "$pcb" ] || die "probe: no coinbase note"
wallet alice create-tx --names "[$pcb]" --recipient "{\"kind\":\"p2pkh\",\"address\":\"$MY\",\"amount\":1000}" --fee-nicks "${FEE_NICKS:-8192}" --allow-low-fee >"$S/probe/create.txt" 2>&1 || die "probe create-tx"
list_tx_files alice > "$S/probe/after.txt"; comm -13 "$S/probe/before.txt" "$S/probe/after.txt" > "$S/probe/new.txt"
PROBE=$(head -1 "$S/probe/new.txt"); [ -s "$PROBE" ] || die "probe produced no transaction"
"$NMEME_TX" seeds "$PROBE" > "$S/probe/seeds.txt" || die "probe seeds"
MY_LOCK=$(awk -F'\t' '$1=="SEED"{print $4"\t"$3}' "$S/probe/seeds.txt" | sort -n | head -1 | cut -f2); rm -f "$PROBE"
[ -n "$MY_LOCK" ] && [ "$MY_LOCK" != "$ALICE_LOCK" ] || die "could not resolve $WHO's lock root"
echo "WALLET	$WHO	address=$MY	lock=$MY_LOCK	keys=$RUN/keys/$WHO.export"
balances "created"

echo "== 2. funding: alice pays $WHO $FUND_NICKS nicks =="
f=$(echo "$ALICE_FIRSTS" | awk '{print $1}')
quiet "$NMEME_INDEX" funding --addr "$PUB" --first "$f" > "$S/funding-alice.txt" || die "funding read"
cb=$(awk -F'\t' -v need=$((FUND_NICKS + 20000)) '$1=="FUNDING" && $4=="coinbase" && $5+0>=need {print $2" "$3; exit}' "$S/funding-alice.txt"); [ -n "$cb" ] || die "no coinbase note"
nock0=$(nock_at "$MY_LOCK")
ftx=$(create_tx alice "$S/fund" "[$cb]" "$MY" "$FUND_NICKS")
quiet "$NMEME_INDEX" check-inputs --addr "$PUB" --tx "$ftx" > "$S/fund/check-inputs.txt" 2>&1 || die "fund: gate"
send_tracked alice fund "$ftx"
wallet "$WHO" list-notes >/dev/null 2>&1 || true
echo "FUND	txid=$TXID	height=$HEIGHT	from=alice	to=$WHO	nicks=$FUND_NICKS	${WHO}_nock: $nock0 -> $(nock_at "$MY_LOCK")	($(w_nock "$MY_LOCK"))"
balances "funded"

echo "== 3. buy from the main pool of token B with $BUY_NICKS nicks =="
pick=$(w_pick_plain "$WHO" "$MY_LOCK" $((BUY_NICKS + DUST + ${FEE_NICKS:-16384} + 1000))) || die "buy: no plain note large enough (funds never come from token notes)"
st=$(pool_state "$TOKEN_B" "$FEE_BPS"); [ -n "$st" ] || die "no main pool"
nock0=$(nock_at "$MY_LOCK"); tok0=$(tokens_at "$MY_LOCK" "$TOKEN_B")
r=$(prepared "$WHO" buy "[${pick%% *} $(cut -d' ' -f2 <<<"$pick")]" "$ALICE" "$BUY_NICKS")
"$NMEME_TX" pool-trade "${r%% *}" "$S/buy/assembled.jam" --pool "$st" --token "$TOKEN_B" --fee-bps "$FEE_BPS" $PP --side buy --placeholder "$ALICE_LOCK" --dust "$DUST" > "$S/buy/trade.txt" 2>&1 || die "buy: pool-trade: $(tail -1 "$S/buy/trade.txt")"
sed 's/^/  /' "$S/buy/trade.txt" >&2; w_fee_ok "$S/buy/trade.txt" || die "buy: the fee does not cover what the chain requires"
resign "$WHO" "${r#* }" "$S/buy/assembled.jam" "$S/buy/trade.txt" "$S/buy/final.jam"
send_tracked "$WHO" buy "$S/buy/final.jam"
want=$(awk -F'\t' '$1=="POOL-AFTER"{print $2" "$3}' "$S/buy/trade.txt"); st2=$(pool_state "$TOKEN_B" "$FEE_BPS")
[ "$(cut -d' ' -f4,5 <<<"$st2")" = "$want" ] || die "buy: pool state $(cut -d' ' -f4,5 <<<"$st2") != quoted $want"
echo "BUY	txid=$TXID	height=$HEIGHT	$(grep '^QUOTE' "$S/buy/trade.txt" | cut -f2- | tr '\t' ' ')	${WHO}_nock: $nock0 -> $(nock_at "$MY_LOCK")	${WHO}_tokens: $tok0 -> $(tokens_at "$MY_LOCK" "$TOKEN_B")"
balances "after buy"

echo "== 4. sell half back =="
tn=$(token_note_at "$MY_LOCK" "$TOKEN_B"); [ -n "$tn" ] || die "sell: $WHO holds no token note"
tf="${tn%% *}"; r1="${tn#* }"; tl="${r1%% *}"; held="${r1#* }"; half=$((held / 2))
st=$(pool_state "$TOKEN_B" "$FEE_BPS"); nock0=$(nock_at "$MY_LOCK"); tok0=$(tokens_at "$MY_LOCK" "$TOKEN_B")
pick=$(w_pick_plain "$WHO" "$MY_LOCK" $((DUST + ${FEE_NICKS:-16384} + 20000))) || die "sell: no plain note for the fee (a token note is never the source of fees)"
r=$(prepared "$WHO" sell "[$tf $tl],[${pick%% *} $(cut -d' ' -f2 <<<"$pick")]" "$ALICE" "$DUST" "$tf $tl")
"$NMEME_TX" pool-trade "${r%% *}" "$S/sell/assembled.jam" --pool "$st" --token "$TOKEN_B" --fee-bps "$FEE_BPS" $PP --side sell --placeholder "$ALICE_LOCK" --dust "$DUST" --tokens-in "$half" --claim "$MY_LOCK=transfer:$TOKEN_B:$((held - half))" > "$S/sell/trade.txt" 2>&1 || die "sell: pool-trade: $(tail -1 "$S/sell/trade.txt")"
sed 's/^/  /' "$S/sell/trade.txt" >&2; w_fee_ok "$S/sell/trade.txt" || die "sell: the fee does not cover what the chain requires"
resign "$WHO" "${r#* }" "$S/sell/assembled.jam" "$S/sell/trade.txt" "$S/sell/final.jam"
send_tracked "$WHO" sell "$S/sell/final.jam"
want=$(awk -F'\t' '$1=="POOL-AFTER"{print $2" "$3}' "$S/sell/trade.txt"); st2=$(pool_state "$TOKEN_B" "$FEE_BPS")
[ "$(cut -d' ' -f4,5 <<<"$st2")" = "$want" ] || die "sell: pool state $(cut -d' ' -f4,5 <<<"$st2") != quoted $want"
[ "$(tokens_at "$MY_LOCK" "$TOKEN_B")" = $((held - half)) ] || die "sell: $WHO's change claim"
echo "SELL	txid=$TXID	height=$HEIGHT	$(grep '^QUOTE' "$S/sell/trade.txt" | cut -f2- | tr '\t' ' ')	${WHO}_nock: $nock0 -> $(nock_at "$MY_LOCK")	${WHO}_tokens: $tok0 -> $(tokens_at "$MY_LOCK" "$TOKEN_B")	(change claim $((held - half)) kept)"
balances "after sell"

echo "== 5. transfer $XFER tokens to bob =="
tn=$(token_note_at "$MY_LOCK" "$TOKEN_B"); tf="${tn%% *}"; r1="${tn#* }"; tl="${r1%% *}"; held="${r1#* }"
[ "$held" -gt "$XFER" ] || die "transfer: $WHO holds $held"
tok0=$(tokens_at "$MY_LOCK" "$TOKEN_B"); bob0=$(tokens_at "$BOB_LOCK" "$TOKEN_B"); nock0=$(nock_at "$MY_LOCK")
pick=$(w_pick_plain "$WHO" "$MY_LOCK" $((DUST + ${FEE_NICKS:-16384} + 20000))) || die "transfer: no plain note for the fee"
r=$(prepared "$WHO" xfer "[$tf $tl],[${pick%% *} $(cut -d' ' -f2 <<<"$pick")]" "$BOB" "$DUST" "$tf $tl")
"$NMEME_TX" attach "${r%% *}" "$S/xfer/attached.jam" "$BOB_LOCK=transfer:$TOKEN_B:$XFER" "$MY_LOCK=transfer:$TOKEN_B:$((held - XFER))" > "$S/xfer/attach.txt" || die "transfer: attach: $(tail -1 "$S/xfer/attach.txt")"
w_fee_ok "$S/xfer/attach.txt" || die "transfer: the fee does not cover what the chain requires"
resign "$WHO" "${r#* }" "$S/xfer/attached.jam" "$S/xfer/attach.txt" "$S/xfer/final.jam"
send_tracked "$WHO" xfer "$S/xfer/final.jam"
[ "$(tokens_at "$MY_LOCK" "$TOKEN_B")" = $((tok0 - XFER)) ] || die "transfer: $WHO's tokens"
[ "$(tokens_at "$BOB_LOCK" "$TOKEN_B")" = $((bob0 + XFER)) ] || die "transfer: bob's tokens"
echo "TRANSFER	txid=$TXID	height=$HEIGHT	tokens=$XFER	from=$WHO	to=bob	${WHO}_tokens: $tok0 -> $(tokens_at "$MY_LOCK" "$TOKEN_B")	bob_tokens: $bob0 -> $(tokens_at "$BOB_LOCK" "$TOKEN_B")	${WHO}_nock: $nock0 -> $(nock_at "$MY_LOCK")	(dust $DUST and the network fee)"
balances "after transfer"
echo "LEDGER	$WHO	pending now: $(w_pending "$WHO" | wc -l) (every sent transaction was mined and released)"
echo "#### wallet demo complete"
