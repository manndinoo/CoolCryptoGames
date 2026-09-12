#!/usr/bin/env bash
# Node and indexer under one token rule (review of pack 5, points 1 and 2).
#
#   0  alice hands bob 100 A and 100 B in notes carrying 300,000 nicks each
#      (the demo's 100-token notes hold 1,000 nicks: the stock wallet's
#      planner floors the fee of any spend around 3,500 nicks and spreads
#      the fee evenly over the notes named, so such a note cannot be spent
#      by it at all — a wallet-side fact, recorded in docs/WALLET.md)
#   A  bob spends the 100 of token A and claims 99: the node accepts
#      (outputs <= inputs), the indexer holds 99 and records 1 burned
#   B  one transaction carrying two tokens: bob's 99 A and 100 B, A kept,
#      B to alice: accepted, both accounted
#   C  the 99 A sold into a pool of token A (fee POOL_FEE): the covenant
#      and the treasury's share on a sell (paid == floor)
#   D  genesis bounds, each refused on arrival: lowercase ticker, decimals
#      19, amount over the cap, amount zero, the wrong id, two tickers in one
#      genesis, a zero transfer claim, an oversized transfer claim; and the
#      edge accepted: a two-limb ticker, 18 decimals, the cap itself
#   E  the indexer rebuilt from the chain with provenance: token A totals
#      999,999 (one unit burned in A), the steps' effects, the pool replay
#
# Runs after pool-suite.sh on the same chain (bob still holds the demo's
# 100 A and 100 B). Output lines: SHORT, MULTI, OPEN, SELL, LORE, GENESIS,
# REJECTED, REBUILD, REPLAY-OK.
set -euo pipefail
REPO="${REPO:?}"; RUN="${RUN:?}"; PORT="${PORT:-25655}"; PUB="${PUBLIC_ADDR:-127.0.0.1:5556}"
WALLET="$REPO/target/release/nockchain-wallet"
NMEME_TX="${NMEME_TX:-$REPO/target/release/nmeme-tx}"
NMEME_INDEX="${NMEME_INDEX:-$REPO/target/release/nmeme-index}"
MINER="$REPO/target/release/zk-pow-mine"
W="$RUN/wallets"; S="$RUN/rules"; mkdir -p "$S"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/lib-verify.sh"; . "$HERE/lib-mine.sh"; . "$HERE/lib-tx.sh"
TOKEN_A="${TOKEN_A:?}"; TOKEN_B="${TOKEN_B:?}"; GTX_A="${GTX_A:?}"; XTX_A="${XTX_A:?}"; GTX_B="${GTX_B:?}"; XTX_B="${XTX_B:?}"
ALICE_LOCK="${ALICE_LOCK:?}"; BOB_LOCK="${BOB_LOCK:?}"; ALICE_FIRSTS="${ALICE_FIRSTS:?}"
LORE_BPS="${LORE_BPS:-50}"; LORE_LOCK="${LORE_LOCK:?the lock root of the Lore Wallet (pool-suite.sh resolves it)}"
POOL_FEE="${POOL_FEE:-120}"; POOL_NOCK="${POOL_NOCK:-6553600}"; POOL_TOKENS="${POOL_TOKENS:-10000}"
DUST="${DUST:-1000}"; SUPPLY="${SUPPLY:-1000000}"
export NMEME_FEE_HEIGHT="${NMEME_FEE_HEIGHT:-1}"
PP="--lore-bps $LORE_BPS --lore-lock $LORE_LOCK"
ALICE=$(wallet alice list-master-addresses | strip | grep -oE '^- Address: [A-Za-z0-9]+' | head -1 | sed 's/^- Address: //')
BOB=$(wallet bob list-master-addresses | strip | grep -oE '^- Address: [A-Za-z0-9]+' | head -1 | sed 's/^- Address: //')
[ -n "$ALICE" ] && [ -n "$BOB" ] || die "wallet addresses"
"$MINER" --node-addr "http://127.0.0.1:$PORT" --mining-pkh "$ALICE" --num-threads 1 >"$RUN/miner.log" 2>&1 &
MINER_PID=$!; trap 'kill "$MINER_PID" 2>/dev/null || true' EXIT
for who in alice bob; do wallet "$who" list-notes >/dev/null 2>&1 || true; done
USED="$S/used-notes.txt"; : > "$USED"

funding_alice() {
  local out="$1" f i=0; : > "$out"
  for f in $ALICE_FIRSTS; do i=$((i+1)); quiet "$NMEME_INDEX" funding --addr "$PUB" --first "$f" > "$out.$i" || die "funding read at $f"; cat "$out.$i" >> "$out"; done
  quiet "$NMEME_INDEX" funding --addr "$PUB" --lock "$ALICE_LOCK" > "$out.lock" || die "funding read at alice lock"
  cat "$out.lock" >> "$out"
}
coinbase_note() { # <funding-file> <min-nicks>: a verified coinbase note not yet used
  local n
  while read -r n; do grep -qF "$n" "$USED" 2>/dev/null || { echo "$n"; echo "$n" >> "$USED"; return 0; }; done \
    < <(awk -F'\t' -v need="$2" '$1=="FUNDING" && $4=="coinbase" && $5+0>=need {print $2" "$3}' "$1")
  return 0
}
# token_note_at <lock> <token> -> "first last amount" (the largest note)
# (a lock holding none of the token makes the indexer exit non-zero: a zero here, not an error)
token_note_at() {
  { quiet "$NMEME_INDEX" token-note --addr "$PUB" --lock "$1" --token "$2" 2>/dev/null || true; } | awk -F'\t' '$1=="NOTE" {gsub(/[][]/,"",$2); print $4" "$2}' | sort -rn | head -1 | awk '{print $2" "$3" "$1}'
}
token_total_at() { # <lock> <token> -> units held (indexer's live view)
  { quiet "$NMEME_INDEX" token-note --addr "$PUB" --lock "$1" --token "$2" 2>/dev/null || true; } | awk -F'\t' '$1=="NOTE"{s+=$4} END{print s+0}'
}
pool_state() { quiet "$NMEME_INDEX" pool --addr "$PUB" --token "$1" --fee-bps "$2" $PP 2>/dev/null | awk -F'\t' '$1=="POOL"{print $2" "$3" "$4" "$5" "$6}'; }
pool_lock() { "$NMEME_TX" pool-lock --token "$1" --fee-bps "$2" $PP | awk -F'\t' '$1=="POOL-LOCK"{print $2}'; }
lore_balance() { quiet "$NMEME_INDEX" funding --addr "$PUB" --lock "$LORE_LOCK" 2>/dev/null | awk -F'\t' '$1=="FUNDING"{n++; s+=$5; if ($4!="plain") bad++} END{print s+0" "n+0" "bad+0}'; }
# plain_note_at <lock> <need>: a plain unspent note at the lock holding at least <need>, not yet used
# (a manual --names selection is exact: the wallet adds nothing for the fee, so the plain note
# that pays it is named alongside the token note; a token note is never the source of fees)
plain_note_at() {
  local n
  while read -r n; do grep -qF "$n" "$USED" 2>/dev/null || { echo "$n"; echo "$n" >> "$USED"; return 0; }; done \
    < <(quiet "$NMEME_INDEX" funding --addr "$PUB" --lock "$1" 2>/dev/null | awk -F'\t' -v need="$2" '$1=="FUNDING" && $4=="plain" && $5+0>=need {print $2" "$3}')
  return 1
}
FEE_NEED=$(( ${FEE_NICKS:-16384} + DUST + 20000 ))
# prepared <who> <label> <names> <to> <amount> [token-note ...]: wallet-built spend, gate, sighash -> "<file> <sighash>"
# (every input that carries a claim is named to the gate: an unnamed one would be a burn)
prepared() {
  local who="$1" label="$2" d="$S/$2"; mkdir -p "$d"
  local tx; tx=$(create_tx "$who" "$d" "$3" "$4" "$5")
  shift 5; local tn gate=()
  for tn in "$@"; do gate+=(--token-note "$tn"); done
  quiet "$NMEME_INDEX" check-inputs --addr "$PUB" --tx "$tx" "${gate[@]}" > "$d/check-inputs.txt" 2>&1 || die "$label: input gate refused (see $d/check-inputs.txt)"
  "$NMEME_TX" sighash "$tx" "$d" > "$d/sighash.txt" || die "$label: sighash"; verify_all "$who" "$d/sighash.txt" "$label-wallet"
  echo "$tx $d/sighash.txt"
}
# finish <who> <label> <sighash> <attached.jam> <attach.txt>: re-sign, send, confirm; sets TXID FILE
finish() {
  local who="$1" label="$2" d="$S/$2"
  resign "$who" "$3" "$4" "$5" "$d/final.jam"
  FILE="$d/final.jam"; TXID=$("$NMEME_INDEX" tx-id --tx "$FILE")
  local sent; sent=$(send "$FILE" "$label"); [ "$sent" = "$TXID" ] || die "$label: send (see $S/send-$label.txt)"
  grep -q "MEMPOOL	admitted" "$S/send-$label.txt" || die "$label: not admitted: $(cat "$S/send-$label.txt")"
  confirm "$TXID" "$label" "$FILE"
}
STEPS_A=""
# provenance for the rebuild (stage E) is read before anything is spent:
# the wallet adds plain notes for fees, and a plain note is proven so by a
# funding read that shows it without a claim
funding_alice "$S/funding0.txt"
quiet "$NMEME_INDEX" funding --addr "$PUB" --lock "$BOB_LOCK" > "$S/funding0-bob.txt" || die "funding read at bob's lock"

# note_out <tx.jam> <lock> -> "first last": the transaction's output note at the lock
note_out() { "$NMEME_INDEX" outputs --tx "$1" | awk -F'\t' -v l="$2" '$1=="OUTPUT" && $2==l {print $3" "$4; exit}'; }

# RESUME=1: every stage up to the edge genesis was mined by an earlier run in
# this $S; pick up its files and go on to the checks and the rebuild
if [ "${RESUME:-0}" = 1 ]; then
  for l in prep-A prep-B short multi open sell edge; do [ -f "$S/$l.env" ] || die "resume: $l was not mined"; done
  for l in prep-A prep-B short multi open sell; do STEPS_A="$STEPS_A --step $("$NMEME_INDEX" tx-id --tx "$S/$l/final.jam"):$S/$l/final.jam"; done
  OPEN_TXID=$("$NMEME_INDEX" tx-id --tx "$S/open/final.jam"); OPEN_FILE="$S/open/final.jam"
  SELL_TXID=$("$NMEME_INDEX" tx-id --tx "$S/sell/final.jam"); SELL_FILE="$S/sell/final.jam"
  SHORT_TXID=$("$NMEME_INDEX" tx-id --tx "$S/short/final.jam")
  lock=$(pool_lock "$TOKEN_A" "$POOL_FEE")
  TXID=$("$NMEME_INDEX" tx-id --tx "$S/edge/final.jam"); FILE="$S/edge/final.jam"
  echo "RESUMED	stages 0-D mined by an earlier run: $(ls "$S"/*.rejected 2>/dev/null | wc -l) refusals recorded, edge genesis $TXID"
fi
if [ "${RESUME:-0}" != 1 ]; then
echo "== 0. alice hands bob 100 A and 100 B in notes that carry NOCK =="
prep() { # <label> <token> -> PREP_NOTE (bob's new note), step appended
  local label="$1" token="$2"
  local tn; tn=$(token_note_at "$ALICE_LOCK" "$token"); [ -n "$tn" ] || die "$label: alice holds no note of $token"
  local tf="${tn%% *}" r1="${tn#* }"; local tl="${r1%% *}" held="${r1#* }"
  local r; r=$(prepared alice "$label" "[$tf $tl]" "$BOB" 300000 "$tf $tl")
  "$NMEME_TX" attach "${r%% *}" "$S/$label/attached.jam" "$BOB_LOCK=transfer:$token:100" "$ALICE_LOCK=transfer:$token:$((held - 100))" > "$S/$label/attach.txt" || die "$label: attach: $(tail -1 "$S/$label/attach.txt")"
  finish alice "$label" "${r#* }" "$S/$label/attached.jam" "$S/$label/attach.txt"
  PREP_NOTE=$(note_out "$FILE" "$BOB_LOCK"); [ -n "$PREP_NOTE" ] || die "$label: no output at bob's lock"
  STEPS_A="$STEPS_A --step $TXID:$FILE"
  echo "PREP	$label	txid=$TXID	height=$(cut -d= -f2 "$S/$label.env")	bob_note=[$PREP_NOTE]	100 of $token with 300000 nicks"
}
prep prep-A "$TOKEN_A"; A_NOTE="$PREP_NOTE"
prep prep-B "$TOKEN_B"; B_NOTE="$PREP_NOTE"

echo "== A. spend 100 of token A, claim 99 =="
bob_a0=$(token_total_at "$BOB_LOCK" "$TOKEN_A")
r=$(prepared bob short "[$A_NOTE]" "$ALICE" "$DUST" "$A_NOTE")
"$NMEME_TX" attach "${r%% *}" "$S/short/attached.jam" "$BOB_LOCK=transfer:$TOKEN_A:99" > "$S/short/attach.txt" || die "short: attach: $(tail -1 "$S/short/attach.txt")"
finish bob short "${r#* }" "$S/short/attached.jam" "$S/short/attach.txt"
SHORT_TXID="$TXID"; SHORT_FILE="$FILE"; STEPS_A="$STEPS_A --step $SHORT_TXID:$SHORT_FILE"
A_NOTE=$(note_out "$SHORT_FILE" "$BOB_LOCK")
bob_a1=$(token_total_at "$BOB_LOCK" "$TOKEN_A")
[ "$bob_a1" = $((bob_a0 - 1)) ] || die "short: the indexer sees bob's A go $bob_a0 -> $bob_a1, expected one unit less"
echo "SHORT	txid=$SHORT_TXID	height=$(cut -d= -f2 "$S/short.env")	spent=100	claimed=99	node=accepted	indexer=bob's A $bob_a0 -> $bob_a1 (99 held, 1 burned)"

echo "== B. one transaction, two tokens: 99 A kept, 100 B to alice =="
alice_b0=$(token_total_at "$ALICE_LOCK" "$TOKEN_B"); bob_b0=$(token_total_at "$BOB_LOCK" "$TOKEN_B")
r=$(prepared bob multi "[$A_NOTE],[$B_NOTE]" "$ALICE" "$DUST" "$A_NOTE" "$B_NOTE")
"$NMEME_TX" attach "${r%% *}" "$S/multi/attached.jam" "$BOB_LOCK=transfer:$TOKEN_A:99" "$ALICE_LOCK=transfer:$TOKEN_B:100" > "$S/multi/attach.txt" || die "multi: attach: $(tail -1 "$S/multi/attach.txt")"
finish bob multi "${r#* }" "$S/multi/attached.jam" "$S/multi/attach.txt"
MULTI_TXID="$TXID"; MULTI_FILE="$FILE"; STEPS_A="$STEPS_A --step $MULTI_TXID:$MULTI_FILE"
A_NOTE=$(note_out "$MULTI_FILE" "$BOB_LOCK")
[ "$(token_total_at "$BOB_LOCK" "$TOKEN_A")" = "$bob_a1" ] || die "multi: bob's A changed"
[ "$(token_total_at "$BOB_LOCK" "$TOKEN_B")" = $((bob_b0 - 100)) ] || die "multi: bob's B"
alice_b1=$(token_total_at "$ALICE_LOCK" "$TOKEN_B"); [ "$alice_b1" = $((alice_b0 + 100)) ] || die "multi: alice's B $alice_b0 -> $alice_b1"
echo "MULTI	txid=$MULTI_TXID	height=$(cut -d= -f2 "$S/multi.env")	in=99A+100B	out=99A(bob)+100B(alice)	node=accepted	indexer=alice's B $alice_b0 -> $alice_b1, bob's B $bob_b0 -> $((bob_b0 - 100)), bob's A unchanged, nothing burned"

echo "== C. the 99 sold into a pool of token A (fee $POOL_FEE) =="
tn=$(token_note_at "$ALICE_LOCK" "$TOKEN_A"); [ -n "$tn" ] || die "alice holds no note of token A"
tf="${tn%% *}"; r1="${tn#* }"; tl="${r1%% *}"; theld="${r1#* }"; [ "$theld" -gt "$POOL_TOKENS" ] || die "alice holds $theld of A"
lock=$(pool_lock "$TOKEN_A" "$POOL_FEE")
r=$(prepared alice open "[$tf $tl]" "$BOB" "$POOL_NOCK" "$tf $tl")
"$NMEME_TX" retarget "${r%% *}" "$S/open/retargeted.jam" "$BOB_LOCK" "$lock" > "$S/open/retarget.txt" || die "open: retarget"
"$NMEME_TX" attach "$S/open/retargeted.jam" "$S/open/attached.jam" "$lock=transfer:$TOKEN_A:$POOL_TOKENS" "$ALICE_LOCK=transfer:$TOKEN_A:$((theld - POOL_TOKENS))" > "$S/open/attach.txt" || die "open: attach: $(tail -1 "$S/open/attach.txt")"
finish alice open "${r#* }" "$S/open/attached.jam" "$S/open/attach.txt"
OPEN_TXID="$TXID"; OPEN_FILE="$FILE"; STEPS_A="$STEPS_A --step $OPEN_TXID:$OPEN_FILE"
st=$(pool_state "$TOKEN_A" "$POOL_FEE"); [ "$(wc -l <<<"$st")" -eq 1 ] || die "open: pool state: $st"
echo "OPEN	txid=$OPEN_TXID	height=$(cut -d= -f2 "$S/open.env")	lock=$lock	pool=$(cut -d' ' -f4,5 <<<"$st" | tr ' ' '/')"
lore0=$(lore_balance); bob_a2=$(token_total_at "$BOB_LOCK" "$TOKEN_A")
r=$(prepared bob sell "[$A_NOTE]" "$ALICE" "$DUST" "$A_NOTE")
"$NMEME_TX" pool-trade "${r%% *}" "$S/sell/assembled.jam" --pool "$st" --token "$TOKEN_A" --fee-bps "$POOL_FEE" $PP --side sell --placeholder "$ALICE_LOCK" --dust "$DUST" --tokens-in 99 > "$S/sell/trade.txt" 2>&1 || die "sell: pool-trade: $(tail -1 "$S/sell/trade.txt")"
sed 's/^/  /' "$S/sell/trade.txt" >&2
finish bob sell "${r#* }" "$S/sell/assembled.jam" "$S/sell/trade.txt"
SELL_TXID="$TXID"; SELL_FILE="$FILE"; STEPS_A="$STEPS_A --step $SELL_TXID:$SELL_FILE"
st2=$(pool_state "$TOKEN_A" "$POOL_FEE"); want=$(awk -F'\t' '$1=="POOL-AFTER"{print $2" "$3}' "$S/sell/trade.txt")
[ "$(cut -d' ' -f4,5 <<<"$st2")" = "$want" ] || die "sell: pool state $(cut -d' ' -f4,5 <<<"$st2") != quoted $want"
lf=$(grep '^QUOTE' "$S/sell/trade.txt" | grep -oE 'lore_fee=[0-9]+' | cut -d= -f2)
lore1=$(lore_balance); [ "${lore1%% *}" = $(( ${lore0%% *} + lf )) ] || die "sell: the Lore Wallet holds ${lore1%% *}, expected $(( ${lore0%% *} + lf ))"
[ "${lore1##* }" = 0 ] || die "sell: a non-plain note at the Lore Wallet"
[ "$(token_total_at "$BOB_LOCK" "$TOKEN_A")" = $((bob_a2 - 99)) ] || die "sell: bob's A"
echo "SELL	txid=$SELL_TXID	height=$(cut -d= -f2 "$S/sell.env")	$(grep '^QUOTE' "$S/sell/trade.txt" | cut -f2- | tr '\t' ' ')	pool_after=$(tr ' ' '/' <<<"$want")	bob's A $bob_a2 -> $((bob_a2 - 99))"
echo "LORE	sell	+$lf nicks	balance=${lore1%% *}	notes=$(cut -d' ' -f2 <<<"$lore1")	all_plain=yes"

echo "== D. genesis bounds and malformed claims, refused on arrival =="
funding_alice "$S/funding.txt"
genesis_case() { # <label> <expect: refused|mined> <claim-spec>...
  local label="$1" expect="$2"; shift 2
  local cb; cb=$(coinbase_note "$S/funding.txt" 200000); [ -n "$cb" ] || die "$label: no coinbase note"
  local r; r=$(prepared alice "$label" "[$cb]" "$BOB" 100000)
  local specs=() sp; for sp in "$@"; do specs+=("$sp"); done
  "$NMEME_TX" attach "${r%% *}" "$S/$label/attached.jam" "${specs[@]}" > "$S/$label/attach.txt" || die "$label: attach: $(tail -1 "$S/$label/attach.txt")"
  resign alice "${r#* }" "$S/$label/attached.jam" "$S/$label/attach.txt" "$S/$label/final.jam"
  if [ "$expect" = refused ]; then
    expect_rejected "$S/$label/final.jam" "$label" "$cb"
  else
    FILE="$S/$label/final.jam"; TXID=$("$NMEME_INDEX" tx-id --tx "$FILE")
    local sent; sent=$(send "$FILE" "$label"); grep -q "MEMPOOL	admitted" "$S/send-$label.txt" || die "$label: not admitted: $(cat "$S/send-$label.txt")"
    confirm "$TXID" "$label" "$FILE"
  fi
}
genesis_case lower refused "$BOB_LOCK=raw-genesis:doge:6:1000"
genesis_case decimals refused "$BOB_LOCK=raw-genesis:DOGE:19:1000"
genesis_case cap refused "$BOB_LOCK=raw-genesis:DOGE:6:9223372036854775808"
genesis_case zero refused "$BOB_LOCK=raw-genesis:DOGE:6:0"
genesis_case wrong-id refused "$BOB_LOCK=raw-genesis:DOGE:6:1000:$ALICE_LOCK"
genesis_case two-tickers refused "$BOB_LOCK=raw-genesis:AAA:6:1000" "$ALICE_LOCK=raw-genesis:BBB:6:1000"
genesis_case zero-transfer refused "$BOB_LOCK=raw-transfer:$TOKEN_A:0"
genesis_case huge-transfer refused "$BOB_LOCK=raw-transfer:$TOKEN_A:9223372036854775808"
genesis_case edge mined "$BOB_LOCK=genesis:LONGTICKER:18:9223372036854775807"
fi
EDGE_TXID="$TXID"; EDGE_FILE="$FILE"
EDGE_ID=$("$NMEME_INDEX" token-id --tx "$EDGE_FILE" --ticker LONGTICKER --decimals 18 | tail -1)
edge_held=$(token_note_at "$BOB_LOCK" "$EDGE_ID" | awk '{print $3}')
[ "$edge_held" = 9223372036854775807 ] || die "edge: bob holds $edge_held of the edge token"
echo "GENESIS	edge	txid=$EDGE_TXID	height=$(cut -d= -f2 "$S/edge.env")	token=$EDGE_ID	ticker=LONGTICKER (two limbs)	decimals=18	supply=9223372036854775807 (the cap)	node=accepted	indexer=bob holds the supply"

echo "== E. rebuild token A with provenance; replay the pool =="
PROOFS="--funding $S/funding0-bob.txt"; for f in "$S"/funding0.txt.* "$S"/funding.txt.*; do [ -f "$f" ] && PROOFS="$PROOFS --funding $f"; done
[ -n "${LIVE_PROOFS:-}" ] && PROOFS="$PROOFS $LIVE_PROOFS"
# alice's token notes were spent by every pool the suite opened (token A) and
# by the main pool (token B), each leaving her change note: those transactions
# are steps here too, in the order they were mined, so that every input of the
# transactions above is an output of an earlier step
PRIOR=""; : > "$S/prior-steps.txt"
for P in "${POOL_DIR:-$RUN/pool}" "$RUN"/rules-attempt*; do
  [ -d "$P" ] || continue
  for e in "$P"/*.env; do
    [ -f "$e" ] || continue; l=$(basename "$e" .env); f="$P/$l/final.jam"
    case "$l" in main|pool-*|donate-*|merge-ok|inflate-claim|prep-*|short|multi|open|sell) [ -f "$f" ] && echo "$(cut -d= -f2 "$e") $l $f" >> "$S/prior-steps.txt";; esac
  done
  # a neutralized inflate-claim trade has no .env: it follows its pool
  if [ -f "$P/inflate-claim.neutralized" ] && ! grep -q " inflate-claim " "$S/prior-steps.txt"; then
    h=$(grep " pool-inflate-claim " "$S/prior-steps.txt" | cut -d' ' -f1); echo "$h inflate-claim $P/inflate-claim/final.jam" >> "$S/prior-steps.txt"
  fi
done
sort -n -s -o "$S/prior-steps.txt" "$S/prior-steps.txt"
while read -r h l f; do PRIOR="$PRIOR --step $("$NMEME_INDEX" tx-id --tx "$f"):$f"; done < "$S/prior-steps.txt"
# shellcheck disable=SC2086
"$NMEME_INDEX" rebuild --addr "$PUB" --token "$TOKEN_A" --step "$GTX_A:${GFILE_A:-$RUN/genesis-A/final.jam}" --step "$XTX_A:${XFILE_A:-$RUN/xfer-A/final.jam}" \
  --step "$GTX_B:${GFILE_B:-$RUN/genesis-B/final.jam}" --step "$XTX_B:${XFILE_B:-$RUN/xfer-B/final.jam}" \
  $PRIOR $STEPS_A $PROOFS --scan-coinbase "$(node_height)" \
  --lock "$ALICE_LOCK" --lock "$BOB_LOCK" --lock "$lock" --expect-total $((SUPPLY - 1)) > "$S/balances-A.txt" || die "rebuild A failed: $(tail -3 "$S/balances-A.txt")"
grep -E "^(EVIDENCE|STEP|BALANCE|TOTAL|ASSERT)" "$S/balances-A.txt" | cut -c1-200
grep -q "^ASSERT-OK" "$S/balances-A.txt" || die "rebuild: no ASSERT-OK"
echo "REBUILD	token A	total=$((SUPPLY - 1))	(one unit burned by the 100->99 spend)	$(grep "^STEP	$SHORT_TXID" "$S/balances-A.txt" | cut -f3 | cut -c1-80)"
"$NMEME_INDEX" pool-replay --token "$TOKEN_A" --fee-bps "$POOL_FEE" $PP --open "$OPEN_TXID:$OPEN_FILE" --step "$SELL_TXID:$SELL_FILE" > "$S/replay-A.txt" || die "replay: $(tail -1 "$S/replay-A.txt")"
cat "$S/replay-A.txt"
due=$(awk -F'\t' '$1=="LORE"{for(i=1;i<=NF;i++) if ($i ~ /^due_floor=/) print substr($i,11)}' "$S/replay-A.txt"); paid=$(awk -F'\t' '$1=="LORE"{for(i=1;i<=NF;i++) if ($i ~ /^paid=/) print substr($i,6)}' "$S/replay-A.txt")
[ "$due" = "$paid" ] || die "replay: the sell paid $paid, the floor is $due; they must be equal"
live=$(pool_state "$TOKEN_A" "$POOL_FEE" | cut -d' ' -f4,5); rep=$(awk -F'\t' '$1=="STATE"{print $2" "$3}' "$S/replay-A.txt")
[ "$live" = "$rep" ] && echo "REPLAY-OK	live pool state $live equals the replayed state; sell paid=$paid due=$due" || die "replay state $rep != live $live"
echo "#### rules test complete"
