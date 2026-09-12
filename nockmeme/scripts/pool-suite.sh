#!/usr/bin/env bash
# The pool suite: a constant-product pool under the %amm covenant, on the
# forked fakenet. Runs after live-demo.sh on the same chain and wallets
# (tokens A and B exist; alice holds most of both).
#
#   1  open the main pool (token B, fee FEE_BPS): NOCK and tokens from alice
#   2  bob buys, bob sells, alice buys: quotes, fills, fee retention, state
#   3  simultaneous trades against one pool note: one wins, the other re-quotes
#   4  attacks, each on its own pool (an admitted-but-invalid transaction
#      keeps its inputs reserved, so one refused attack would block the next
#      test on the same note): withdraw, over-payout, pool pays a miner fee,
#      seed to a third lock, successor without the claim, inflated claim,
#      minted successor, creator's key, taking a second note at the lock
#   5  a donation at the lock merged honestly into the reserves
#   6  rebuild with provenance; replay the main pool's history
#
# Output: result lines on stdout; progress on stderr.
set -euo pipefail
REPO="${REPO:?}"; RUN="${RUN:?}"; PORT="${PORT:-25655}"; PUB="${PUBLIC_ADDR:-127.0.0.1:5556}"
WALLET="$REPO/target/release/nockchain-wallet"
NMEME_TX="${NMEME_TX:-$REPO/target/release/nmeme-tx}"
NMEME_INDEX="${NMEME_INDEX:-$REPO/target/release/nmeme-index}"
MINER="$REPO/target/release/zk-pow-mine"
W="$RUN/wallets"; S="$RUN/pool"; mkdir -p "$S"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/lib-verify.sh"; . "$HERE/lib-mine.sh"; . "$HERE/lib-tx.sh"
FEE_BPS="${FEE_BPS:-100}"          # the pool's share
LORE_BPS="${LORE_BPS:-50}"         # the treasury's share (docs/FEES.md)
POOL_NOCK="${POOL_NOCK:-6553600}"        # 100 NOCK
POOL_TOKENS="${POOL_TOKENS:-100000}"
# the attack pools: twelve of them come out of alice's token A (999,900 after
# the demo), so they are smaller than the main pool
ATTACK_TOKENS="${ATTACK_TOKENS:-10000}"
BUY_NICKS="${BUY_NICKS:-655360}"          # 10 NOCK
BOB_FUND_NICKS="${BOB_FUND_NICKS:-1310720}" # 20 NOCK per bob note
DUST="${DUST:-1000}"
SUPPLY="${SUPPLY:-1000000}"; XFER="${XFER_AMOUNT:-100}"
export NMEME_FEE_HEIGHT="${NMEME_FEE_HEIGHT:-1}"

ALICE=$(wallet alice list-active-addresses | strip | grep -oE '^- Address: .*' | head -1 | sed 's/^- Address: //')
BOB=$(wallet bob list-active-addresses | strip | grep -oE '^- Address: .*' | head -1 | sed 's/^- Address: //')
[ -n "$ALICE" ] && [ -n "$BOB" ] || die "wallet addresses"
ALICE_LOCK="${ALICE_LOCK:?}"; BOB_LOCK="${BOB_LOCK:?}"
TOKEN_B="${TOKEN_B:?the token id of token B}"; TOKEN_A="${TOKEN_A:?the token id of token A}"
GTX_B="${GTX_B:?}"; XTX_B="${XTX_B:?}"; GTX_A="${GTX_A:?}"; XTX_A="${XTX_A:?}"
ALICE_FIRSTS="${ALICE_FIRSTS:?first-names alice coinbase notes sit at}"

echo "== stage 0: the Lore Wallet, and the miner =="
# The treasury: a third wallet whose key is never used to spend. Its lock
# root is what every pool's covenant names; it is read from a throwaway
# transaction paying its address, like alice's and bob's.
if [ ! -f "$W/lore/.done" ]; then
  mkdir -p "$W/lore" "$RUN/keys"; wallet lore keygen >/dev/null 2>&1 || die "keygen failed for lore"
  ( cd "$W/lore" && wallet lore export-keys >/dev/null 2>&1 ) || true
  [ -s "$W/lore/keys.export" ] || die "lore: keygen left no keys.export"
  cp "$W/lore/keys.export" "$RUN/keys/lore.export"; touch "$W/lore/.done"
fi
# a lore wallet whose arena was thrown away (disk) still has its keys
[ -d "$W/lore/wallet" ] || wallet_fresh lore
# the master address list names the imported key (list-active-addresses shows
# nothing for a wallet rebuilt from an export: it lists derived children only)
LORE=$(wallet lore list-master-addresses | strip | grep -oE '^- Address: [A-Za-z0-9]+' | head -1 | sed 's/^- Address: //' || true)
[ -n "$LORE" ] || die "lore address"
if [ -z "${LORE_LOCK:-}" ]; then
  mkdir -p "$S/lore-probe"; list_tx_files alice > "$S/lore-probe/before.txt"
  wallet alice create-tx --recipient "{\"kind\":\"p2pkh\",\"address\":\"$LORE\",\"amount\":1000}" --fee-nicks "${FEE_NICKS:-8192}" --allow-low-fee >"$S/lore-probe/create.txt" 2>&1 || die "lore probe create-tx"
  list_tx_files alice > "$S/lore-probe/after.txt"; comm -13 "$S/lore-probe/before.txt" "$S/lore-probe/after.txt" > "$S/lore-probe/new.txt"
  PROBE=$(head -1 "$S/lore-probe/new.txt"); [ -s "$PROBE" ] || die "lore probe produced no transaction"
  "$NMEME_TX" seeds "$PROBE" > "$S/lore-probe/seeds.txt" || die "lore probe seeds"
  LORE_LOCK=$(awk -F'\t' '$1=="SEED"{print $4"\t"$3}' "$S/lore-probe/seeds.txt" | sort -n | head -1 | cut -f2)
  rm -f "$PROBE"
fi
[ -n "$LORE_LOCK" ] && [ "$LORE_LOCK" != "$ALICE_LOCK" ] || die "could not resolve the Lore Wallet's lock root"
echo "LORE-WALLET	address=$LORE	lock=$LORE_LOCK	first=$("$NMEME_TX" pool-lock --token "$TOKEN_B" --fee-bps 1 --lore-bps 1 --lore-lock "$LORE_LOCK" | awk -F'\t' '$1=="LORE-FIRST"{print $2}')	key=the lore wallet (held, not locked)"
echo "LORE_LOCK=$LORE_LOCK" >> "$RUN/pool-env.txt"
PP="--lore-bps $LORE_BPS --lore-lock $LORE_LOCK"
# wallets rebuilt from keys know no notes until they have listed them once
for who in alice bob; do wallet "$who" list-notes >/dev/null 2>&1 || true; done
# lore_balance -> "<nicks> <notes> <non-plain notes>"
lore_balance() {
  quiet "$NMEME_INDEX" funding --addr "$PUB" --lock "$LORE_LOCK" > "$S/funding-lore.txt" 2>/dev/null || die "lore funding read"
  awk -F'\t' '$1=="FUNDING"{n++; s+=$5; if ($4!="plain") bad++} END{print s+0" "n+0" "bad+0}' "$S/funding-lore.txt"
}
LORE_EXPECTED=0
"$MINER" --node-addr "http://127.0.0.1:$PORT" --mining-pkh "$ALICE" --num-threads 1 >"$RUN/miner.log" 2>&1 &
MINER_PID=$!; trap 'kill "$MINER_PID" 2>/dev/null || true' EXIT
echo "miner pid=$MINER_PID"
# on a resumed run the treasury already holds earlier trades' shares
if [ "${RESUME:-0}" = 1 ]; then LORE_EXPECTED=$(lore_balance | cut -d' ' -f1); echo "RESUMED	the Lore Wallet holds $LORE_EXPECTED nicks"; fi

# funding_alice <out>: every unspent note of alice, one read per first-name
# (the node per-address cache lags; a read spanning addresses may never
# agree on a height). Also her token notes at her change lock.
funding_alice() {
  local out="$1" f i=0; : > "$out"
  for f in $ALICE_FIRSTS; do i=$((i+1)); quiet "$NMEME_INDEX" funding --addr "$PUB" --first "$f" > "$out.$i" || die "funding read at $f"; cat "$out.$i" >> "$out"; done
  quiet "$NMEME_INDEX" funding --addr "$PUB" --lock "$ALICE_LOCK" > "$out.lock" || die "funding read at alice lock"
  cat "$out.lock" >> "$out"
}
# coinbase_note <funding-file> <min-nicks> <exclude-file>: a verified coinbase note not yet used
coinbase_note() {
  # no pipeline: breaking out of one raises SIGPIPE in awk (seen live, exit 141)
  local n
  while read -r n; do
    grep -qF "$n" "$3" 2>/dev/null || { echo "$n"; return 0; }
  done < <(awk -F'\t' -v need="$2" '$1=="FUNDING" && $4=="coinbase" && $5+0>=need {print $2" "$3}' "$1")
  return 0
}
USED="$S/used-notes.txt"; [ "${RESUME:-0}" = 1 ] && touch "$USED" || : > "$USED"
# token_note <token> -> "first last amount" of alice note holding the token (at her change lock)
token_note() {
  quiet "$NMEME_INDEX" token-note --addr "$PUB" --lock "$ALICE_LOCK" --token "$1" 2>/dev/null | awk -F'\t' '$1=="NOTE" {gsub(/[][]/,"",$2); print $4" "$2}' | sort -rn | head -1 | awk '{print $2" "$3" "$1}'
}
pool_state() { # <token> <fee> -> POOL line fields "first last origin nock tokens" of the single pool note
  quiet "$NMEME_INDEX" pool --addr "$PUB" --token "$1" --fee-bps "$2" $PP > "$S/pool-$1-$2.txt" 2>/dev/null || die "pool read"
  awk -F'\t' '$1=="POOL"{print $2" "$3" "$4" "$5" "$6}' "$S/pool-$1-$2.txt"
}
pool_lock() { "$NMEME_TX" pool-lock --token "$1" --fee-bps "$2" $PP | awk -F'\t' '$1=="POOL-LOCK"{print $2}'; }

# open_pool <label> <token> <fee> <nock> <tokens>: alice opens a pool from her token note.
# Sets OPEN_TXID, OPEN_FILE; prints OPEN line.
open_pool() {
  local label="$1" token="$2" fee="$3" nock="$4" tokens="$5" d="$S/$1"; mkdir -p "$d" "$d/final"
  local tn; tn=$(token_note "$token"); [ -n "$tn" ] || die "$label: alice holds no note of token $token"
  local first="${tn%% *}" rest="${tn#* }" last held; last="${rest%% *}"; held="${rest#* }"
  [ "$held" -gt "$tokens" ] || die "$label: alice holds $held < $tokens"
  local lock; lock=$(pool_lock "$token" "$fee")
  log "== $label: open pool token=$token fee=$fee nock=$nock tokens=$tokens from [$first $last] ($held held) -> lock $lock =="
  local tx; tx=$(create_tx alice "$d" "[$first $last]" "$BOB" "$nock")
  quiet "$NMEME_INDEX" check-inputs --addr "$PUB" --tx "$tx" --token-note "$first $last" > "$d/check-inputs.txt" 2>&1 || die "$label: input gate refused"
  "$NMEME_TX" sighash "$tx" "$d" > "$d/sighash.txt" || die "$label: sighash"; verify_all alice "$d/sighash.txt" "$label-wallet"
  "$NMEME_TX" retarget "$tx" "$d/retargeted.jam" "$BOB_LOCK" "$lock" > "$d/retarget.txt" || die "$label: retarget"
  "$NMEME_TX" attach "$d/retargeted.jam" "$d/attached.jam" "$lock=transfer:$token:$tokens" "$ALICE_LOCK=transfer:$token:$((held - tokens))" > "$d/attach.txt" || die "$label: attach: $(tail -1 "$d/attach.txt")"
  resign alice "$d/sighash.txt" "$d/attached.jam" "$d/attach.txt" "$d/final.jam"
  "$NMEME_TX" sighash "$d/final.jam" "$d/final" > "$d/final-sighash.txt" || die "$label: final sighash"; verify_all alice "$d/final-sighash.txt" "$label-resigned"
  OPEN_FILE="$d/final.jam"; OPEN_TXID=$(send "$OPEN_FILE" "$label"); [ -n "$OPEN_TXID" ] || die "$label: no txid"
  grep -q "MEMPOOL	admitted" "$S/send-$label.txt" || die "$label: not admitted"
  confirm "$OPEN_TXID" "$label" "$OPEN_FILE"
  local st; st=$(pool_state "$token" "$fee"); [ "$(wc -l <<<"$st")" -eq 1 ] || die "$label: expected one pool note, got: $st"
  local x y; x=$(cut -d' ' -f4 <<<"$st"); y=$(cut -d' ' -f5 <<<"$st")
  [ "$x" = "$nock" ] && [ "$y" = "$tokens" ] || die "$label: pool state $x/$y != $nock/$tokens"
  echo "OPEN	$label	txid=$OPEN_TXID	height=$(cut -d= -f2 "$S/$label.env")	lock=$lock	nock=$x	tokens=$y	alice_change=$((held - tokens))"
}

# trade <label> <who> <token> <fee> <side> <user-tx> <orig-sighash> <placeholder-lock> [pool-trade options...]
# Builds, re-signs, writes $S/<label>/final.jam; sets TRADE_FILE TRADE_TXID; prints the QUOTE.
trade() {
  local label="$1" who="$2" token="$3" fee="$4" side="$5" tx="$6" orig="$7" ph="$8"; shift 8
  local d="$S/$label"; mkdir -p "$d"
  local st; st=$(pool_state "$token" "$fee" | head -1); [ -n "$st" ] || die "$label: no pool note"
  "$NMEME_TX" pool-trade "$tx" "$d/assembled.jam" --pool "$st" --token "$token" --fee-bps "$fee" $PP --side "$side" --placeholder "$ph" --dust "$DUST" "$@" > "$d/trade.txt" 2>&1 || die "$label: pool-trade: $(tail -1 "$d/trade.txt")"
  sed 's/^/  /' "$d/trade.txt" >&2
  resign "$who" "$orig" "$d/assembled.jam" "$d/trade.txt" "$d/final.jam"
  "$NMEME_TX" pins "$d/final.jam" > "$d/pins.txt" 2>&1 || true
  TRADE_FILE="$d/final.jam"; TRADE_TXID=$("$NMEME_INDEX" tx-id --tx "$TRADE_FILE")
  POOL_NOTE_IN="$(cut -d' ' -f1,2 <<<"$st")"
  echo "QUOTE	$label	$(grep '^QUOTE' "$d/trade.txt" | cut -f2- | tr '\t' ' ')	pool_before=$(cut -d' ' -f4,5 <<<"$st" | tr ' ' '/')"
}
# user_tx <who> <dir> <names> <placeholder-addr> <amount>: wallet-built spend + its sighash file; prints "<file> <sighash-file>"
user_tx() {
  local who="$1" d="$2"; mkdir -p "$d"
  local tx; tx=$(create_tx "$who" "$d" "$3" "$4" "$5")
  quiet "$NMEME_INDEX" check-inputs --addr "$PUB" --tx "$tx" ${6:+--token-note "$6"} > "$d/check-inputs.txt" 2>&1 || die "$who: input gate refused (see $d/check-inputs.txt)"
  "$NMEME_TX" sighash "$tx" "$d" > "$d/sighash.txt" || die "$who: sighash"; verify_all "$who" "$d/sighash.txt" "$who-wallet"
  echo "$tx $d/sighash.txt"
}
# confirm_trade <label> <token> <fee>: send, confirm, check the pool state against the quote
confirm_trade() {
  local label="$1" token="$2" fee="$3" d="$S/$1"
  local sent; sent=$(send "$TRADE_FILE" "$label"); [ "$sent" = "$TRADE_TXID" ] || die "$label: send (see $S/send-$label.txt)"
  grep -q "MEMPOOL	admitted" "$S/send-$label.txt" || die "$label: not admitted: $(cat "$S/send-$label.txt")"
  confirm "$TRADE_TXID" "$label" "$TRADE_FILE"
  local st; st=$(pool_state "$token" "$fee" | head -1)
  local want; want=$(awk -F'\t' '$1=="POOL-AFTER"{print $2" "$3}' "$d/trade.txt")
  [ "$(cut -d' ' -f4,5 <<<"$st")" = "$want" ] || die "$label: pool state after ($(cut -d' ' -f4,5 <<<"$st")) != quoted ($want)"
  echo "MINED	$label	txid=$TRADE_TXID	height=$(cut -d= -f2 "$S/$label.env")	pool_after=$(tr ' ' '/' <<<"$want")	$(grep '^POOL-SPEND' "$d/trade.txt" | cut -f2- | tr '\t' ' ')"
  STEPS_B="${STEPS_B:-} --step $TRADE_TXID:$TRADE_FILE"
  # the treasury: exactly the quoted share arrived, in NOCK, in a plain note
  local lf; lf=$(grep '^QUOTE' "$d/trade.txt" | grep -oE 'lore_fee=[0-9]+' | cut -d= -f2)
  LORE_EXPECTED=$((LORE_EXPECTED + lf))
  local lb; lb=$(lore_balance)
  [ "${lb%% *}" = "$LORE_EXPECTED" ] || die "$label: the Lore Wallet holds ${lb%% *} nicks, expected $LORE_EXPECTED"
  [ "${lb##* }" = 0 ] || die "$label: the Lore Wallet holds a note that is not plain NOCK"
  echo "LORE	$label	+$lf nicks	balance=${LORE_EXPECTED}	notes=$(cut -d' ' -f2 <<<"$lb")	all_plain=yes"
}
# done_already <label>: on a resumed run, a stage whose transaction was mined is
# picked up from its files rather than run again (its step is added).
done_already() {
  [ "${RESUME:-0}" = 1 ] || return 1
  local f="$S/$1/final.jam"; [ -f "$f" ] || return 1
  if [ ! -f "$S/$1.env" ]; then
    # sent but not recorded (the run died after sending): mined if its inputs are spent
    local ui; ui=$("$NMEME_INDEX" outputs --tx "$f" | awk -F'\t' '$1=="INPUT"{print $2" "$3}' | head -1)
    unspent "${ui%% *}" "${ui##* }" && return 1
    echo "HEIGHT=$(node_height)" > "$S/$1.env"
  fi
  STEPS_B="${STEPS_B:-} --step $("$NMEME_INDEX" tx-id --tx "$f"):$f"
  echo "RESUMED	$1 already mined"
}
bob_note() { # a plain unspent note of bob not yet used
  quiet "$NMEME_INDEX" funding --addr "$PUB" --lock "$BOB_LOCK" > "$S/funding-bob.txt" || die "bob funding"
  local n
  while read -r n; do grep -qF "$n" "$USED" || { echo "$n"; return 0; }; done < <(awk -F'\t' -v need=$((BUY_NICKS + 20000)) '$1=="FUNDING" && $4=="plain" && $5+0>=need {print $2" "$3}' "$S/funding-bob.txt")
  return 0
}
bob_token_note() { quiet "$NMEME_INDEX" token-note --addr "$PUB" --lock "$BOB_LOCK" --token "$1" 2>/dev/null | awk -F'\t' '$1=="NOTE" {gsub(/[][]/,"",$2); print $4" "$2}' | sort -rn | head -1 | awk '{print $2" "$3" "$1}'; }

echo "== stage 1: fund bob with ${BOB_NOTES:-4} plain notes =="
funding_alice "$S/funding-0.txt"
for i in $(seq 1 "${BOB_NOTES:-4}"); do
  cb=$(coinbase_note "$S/funding-0.txt" $((BOB_FUND_NICKS + 20000)) "$USED"); [ -n "$cb" ] || die "no coinbase note for bob's funding $i"
  echo "$cb" >> "$USED"
  ftx=$(create_tx alice "$S/fund-$i" "[$cb]" "$BOB" "$BOB_FUND_NICKS")
  quiet "$NMEME_INDEX" check-inputs --addr "$PUB" --tx "$ftx" > "$S/fund-$i/check-inputs.txt" 2>&1 || die "fund $i gate"
  cp "$ftx" "$S/fund-$i.jam"; ftxid=$(send "$S/fund-$i.jam" "fund-$i"); [ -n "$ftxid" ] || die "fund $i: no txid"
  grep -q "MEMPOOL	admitted" "$S/send-fund-$i.txt" || die "fund $i: not admitted"
  confirm "$ftxid" "fund-$i" "$S/fund-$i.jam"
  echo "FUND	bob	txid=$ftxid	height=$(cut -d= -f2 "$S/fund-$i.env")	+$BOB_FUND_NICKS nicks"
done

echo "== stage 2: the main pool (token B) =="
MAIN_LOCK=$(pool_lock "$TOKEN_B" "$FEE_BPS")
STEPS_B=""
if [ "${RESUME:-0}" = 1 ] && [ -f "$S/main.env" ]; then
  # an earlier run opened the pool (and maybe traded); pick up its files
  MAIN_OPEN_TXID=$(awk -F'\t' '$1=="TXID"{print $2}' "$S/send-main.txt"); MAIN_OPEN_FILE="$S/main/final.jam"
  for t in buy1; do [ -f "$S/$t.env" ] && STEPS_B="$STEPS_B --step $("$NMEME_INDEX" tx-id --tx "$S/$t/final.jam"):$S/$t/final.jam"; done
  echo "RESUMED	main pool opened by $MAIN_OPEN_TXID; steps so far:$STEPS_B"
else
  open_pool main "$TOKEN_B" "$FEE_BPS" "$POOL_NOCK" "$POOL_TOKENS"
  MAIN_OPEN_TXID="$OPEN_TXID"; MAIN_OPEN_FILE="$OPEN_FILE"
fi
echo "LOCK	main	$MAIN_LOCK	spend-condition=[%amm $TOKEN_B $FEE_BPS $LORE_BPS $LORE_LOCK]	no key"

echo "== stage 3: honest trades =="
if [ -f "$S/buy1.env" ] && [ "${RESUME:-0}" = 1 ]; then
  echo "RESUMED	buy1 already mined"
  r="$(head -1 "$S/buy1-user/new.txt" 2>/dev/null || ls "$W"/bob/txs/*.tx | head -1) $S/buy1-user/sighash.txt"
else
# bob buys with BUY_NICKS
bn=$(bob_note); [ -n "$bn" ] || die "bob has no plain note"; echo "$bn" >> "$USED"
r=$(user_tx bob "$S/buy1-user" "[$bn]" "$ALICE" "$BUY_NICKS")
trade buy1 bob "$TOKEN_B" "$FEE_BPS" buy "${r%% *}" "${r#* }" "$ALICE_LOCK"
confirm_trade buy1 "$TOKEN_B" "$FEE_BPS"
fi
# a too-small trade is refused before anything is built
set +e; "$NMEME_TX" pool-trade "${r%% *}" /dev/null --pool "$(pool_state "$TOKEN_B" "$FEE_BPS")" --token "$TOKEN_B" --fee-bps "$FEE_BPS" $PP --side buy --placeholder "$ALICE_LOCK" --dust "$((BUY_NICKS - 4000))" > "$S/tiny.txt" 2>&1; rc=$?; set -e
[ $rc -ne 0 ] && grep -q "trade too small\|NoOutput\|no output" "$S/tiny.txt" && echo "ROUNDING	a trade the covenant admits no output for is refused by the quote: $(tail -1 "$S/tiny.txt")" || echo "ROUNDING	unexpected: rc=$rc $(tail -1 "$S/tiny.txt")"

# bob sells half of what he bought
if ! done_already sell1; then
btn=$(bob_token_note "$TOKEN_B"); [ -n "$btn" ] || die "bob holds no token note"
b_first="${btn%% *}"; b_rest="${btn#* }"; b_last="${b_rest%% *}"; b_held="${b_rest#* }"
sell_amt=$((b_held / 2))
r=$(user_tx bob "$S/sell1-user" "[$b_first $b_last]" "$ALICE" "$DUST" "$b_first $b_last")
trade sell1 bob "$TOKEN_B" "$FEE_BPS" sell "${r%% *}" "${r#* }" "$ALICE_LOCK" --tokens-in "$sell_amt" --claim "$BOB_LOCK=transfer:$TOKEN_B:$((b_held - sell_amt))"
confirm_trade sell1 "$TOKEN_B" "$FEE_BPS"
fi

# alice buys from a coinbase note (she is the creator; the pool treats her like anyone)
funding_alice "$S/funding-1.txt"
if ! done_already buy2; then
cb=$(coinbase_note "$S/funding-1.txt" $((BUY_NICKS + 20000)) "$USED"); echo "$cb" >> "$USED"
r=$(user_tx alice "$S/buy2-user" "[$cb]" "$BOB" "$BUY_NICKS")
trade buy2 alice "$TOKEN_B" "$FEE_BPS" buy "${r%% *}" "${r#* }" "$BOB_LOCK"
confirm_trade buy2 "$TOKEN_B" "$FEE_BPS"
fi

echo "== stage 4: simultaneous trades against one pool note =="
if [ "${RESUME:-0}" = 1 ] && [ -f "$S/requote.env" ]; then
  # the winner's step must precede the re-quote's (which spends its output); a
  # transaction was mined only if every one of its inputs is spent (the loser
  # shares the pool note with the winner, so one spent input proves nothing)
  for lbl in sim-bob sim-alice; do
    f="$S/$lbl/final.jam"; [ -f "$f" ] || continue; mined=1
    while read -r fn ln; do unspent "$fn" "$ln" </dev/null && mined=0; done < <("$NMEME_INDEX" outputs --tx "$f" | awk -F'\t' '$1=="INPUT"{print $2" "$3}')
    [ "$mined" = 1 ] && { STEPS_B="$STEPS_B --step $("$NMEME_INDEX" tx-id --tx "$f"):$f"; echo "RESUMED	$lbl already mined (the simultaneous winner)"; }
  done
  done_already requote || die "requote: recorded but not mined"
else
bn=$(bob_note); echo "$bn" >> "$USED"
r1=$(user_tx bob "$S/sim-bob-user" "[$bn]" "$ALICE" "$BUY_NICKS")
cb=$(coinbase_note "$S/funding-1.txt" $((BUY_NICKS + 20000)) "$USED"); echo "$cb" >> "$USED"
r2=$(user_tx alice "$S/sim-alice-user" "[$cb]" "$BOB" "$BUY_NICKS")
trade sim-bob bob "$TOKEN_B" "$FEE_BPS" buy "${r1%% *}" "${r1#* }" "$ALICE_LOCK"; F1="$TRADE_FILE"; T1="$TRADE_TXID"
trade sim-alice alice "$TOKEN_B" "$FEE_BPS" buy "${r2%% *}" "${r2#* }" "$BOB_LOCK"; F2="$TRADE_FILE"; T2="$TRADE_TXID"
s1=$(send "$F1" sim-bob); s2=$(send "$F2" sim-alice)
echo "SIMULTANEOUS	sent	bob=$T1 ($(awk -F'\t' '$1=="MEMPOOL"{print $2}' "$S/send-sim-bob.txt"))	alice=$T2 ($(awk -F'\t' '$1=="MEMPOOL"{print $2}' "$S/send-sim-alice.txt"))"
h0=$(node_height); wait_for_height "$RUN/node.log" $((h0 + 3)) "${MINE_TIMEOUT:-900}" >/dev/null
winner=""; loser=""
for t in "$T1:sim-bob:$F1" "$T2:sim-alice:$F2"; do
  id="${t%%:*}"; rest="${t#*:}"; lbl="${rest%%:*}"; f="${rest#*:}"
  pn=$(cut -d' ' -f1,2 <<<"$POOL_NOTE_IN")
  if unspent "${pn%% *}" "${pn##* }"; then loser="$lbl"; else
    # the pool note is spent: which transaction spent it is the one whose own user input is spent too
    ui=$("$NMEME_INDEX" outputs --tx "$f" | awk -F'\t' '$1=="INPUT"{print $2" "$3}' | grep -v "^${pn%% *} " | head -1)
    if unspent "${ui%% *}" "${ui##* }"; then loser="$lbl"; else
      winner="$lbl"; STEPS_B="$STEPS_B --step $id:$f"
      wl=$(grep '^QUOTE' "$S/$lbl/trade.txt" | grep -oE 'lore_fee=[0-9]+' | cut -d= -f2); LORE_EXPECTED=$((LORE_EXPECTED + wl))
      lb=$(lore_balance); [ "${lb%% *}" = "$LORE_EXPECTED" ] || die "$lbl: the Lore Wallet holds ${lb%% *} nicks, expected $LORE_EXPECTED"
      echo "LORE	$lbl	+$wl nicks	balance=$LORE_EXPECTED	notes=$(cut -d' ' -f2 <<<"$lb")	all_plain=$([ "${lb##* }" = 0 ] && echo yes || echo NO)"
    fi
  fi
done
[ -n "$winner" ] && [ -n "$loser" ] || die "simultaneous: winner=$winner loser=$loser"
echo "SIMULTANEOUS	mined=$winner	not_mined=$loser	(the second spend of the same pool note cannot be valid once the first is)"
# the loser re-quotes against the new pool note, with a fresh input
if [ "$loser" = "sim-bob" ]; then
  bn=$(bob_note); echo "$bn" >> "$USED"; r=$(user_tx bob "$S/requote-user" "[$bn]" "$ALICE" "$BUY_NICKS")
  trade requote bob "$TOKEN_B" "$FEE_BPS" buy "${r%% *}" "${r#* }" "$ALICE_LOCK"
else
  cb=$(coinbase_note "$S/funding-1.txt" $((BUY_NICKS + 20000)) "$USED"); echo "$cb" >> "$USED"; r=$(user_tx alice "$S/requote-user" "[$cb]" "$BOB" "$BUY_NICKS")
  trade requote alice "$TOKEN_B" "$FEE_BPS" buy "${r%% *}" "${r#* }" "$BOB_LOCK"
fi
confirm_trade requote "$TOKEN_B" "$FEE_BPS"
fi

echo "== stage 5: attacks, each on its own pool (token A) =="
# attack <label> <fee> <pool-trade options...>: alice (the creator) attacks her own fresh pool from a coinbase note
ATT_STEPS_A=""
attack() {
  local label="$1" fee="$2"; shift 2
  if [ "${RESUME:-0}" = 1 ] && { [ -f "$S/$label.rejected" ] || [ -f "$S/$label.neutralized" ]; }; then
    echo "RESUMED	$label already tested: $(cat "$S/$label.rejected" "$S/$label.neutralized" 2>/dev/null | head -1)"
    ATT_STEPS_A="$ATT_STEPS_A --step $(awk -F'\t' '$1=="TXID"{print $2}' "$S/send-pool-$label.txt"):$S/pool-$label/final.jam"
    return 0
  fi
  open_pool "pool-$label" "$TOKEN_A" "$fee" "$POOL_NOCK" "$ATTACK_TOKENS"
  ATT_STEPS_A="$ATT_STEPS_A --step $OPEN_TXID:$OPEN_FILE"
  funding_alice "$S/funding-$label.txt"
  local cb; cb=$(coinbase_note "$S/funding-$label.txt" $((BUY_NICKS + 20000)) "$USED"); echo "$cb" >> "$USED"
  local r; r=$(user_tx alice "$S/$label-user" "[$cb]" "$BOB" "$BUY_NICKS")
  trade "$label" alice "$TOKEN_A" "$fee" buy "${r%% *}" "${r#* }" "$BOB_LOCK" "$@"
  expect_rejected "$TRADE_FILE" "$label" "$POOL_NOTE_IN" "$cb"
}
attack withdraw 101 --withdraw 100000
QO=$(grep '^QUOTE' "$S/withdraw/trade.txt" | grep -oE 'out_net=[0-9]+' | cut -d= -f2)
[ -n "$QO" ] || die "no quoted output to exceed"
attack over-payout 113 --payout "$((QO + 1))"
attack pool-fee 114 --pool-fee 1
attack third-lock 104 --extra-seed "$ALICE_LOCK:1000"
attack drop-claim 105 --drop-claim
# A fabricated claim on the trader's own payment to the pool. Consensus
# unions the note-data of the seeds landing on a lock, so the claim either
# overwrites the successor's (then conservation fails: refused) or is
# overwritten by it (then the transaction is an ordinary trade). Either way
# the pool holds exactly what the quote said.
attack_neutral() {
  local label="$1" fee="$2"; shift 2
  if [ "${RESUME:-0}" = 1 ] && { [ -f "$S/$label.rejected" ] || [ -f "$S/$label.neutralized" ]; }; then
    echo "RESUMED	$label already tested: $(cat "$S/$label.rejected" "$S/$label.neutralized" 2>/dev/null | head -1)"; return 0
  fi
  open_pool "pool-$label" "$TOKEN_A" "$fee" "$POOL_NOCK" "$ATTACK_TOKENS"
  ATT_STEPS_A="$ATT_STEPS_A --step $OPEN_TXID:$OPEN_FILE"
  funding_alice "$S/funding-$label.txt"
  local cb; cb=$(coinbase_note "$S/funding-$label.txt" $((BUY_NICKS + 20000)) "$USED"); echo "$cb" >> "$USED"
  local r; r=$(user_tx alice "$S/$label-user" "[$cb]" "$BOB" "$BUY_NICKS")
  trade "$label" alice "$TOKEN_A" "$fee" buy "${r%% *}" "${r#* }" "$BOB_LOCK" "$@"
  local txid="$TRADE_TXID"; local sent; sent=$(send "$TRADE_FILE" "$label")
  local h0; h0=$(node_height); wait_for_height "$RUN/node.log" $((h0 + 2)) "${MINE_TIMEOUT:-900}" >/dev/null
  local pn; pn=$(cut -d' ' -f1,2 <<<"$POOL_NOTE_IN")
  if unspent "${pn%% *}" "${pn##* }"; then
    echo "REJECTED	$label	txid=$txid	mempool: $(awk -F'\t' '$1=="MEMPOOL"{print $2}' "$S/send-$label.txt")	not mined in 2 blocks	inputs still unspent" | tee "$S/$label.rejected"
  else
    local st want; st=$(pool_state "$TOKEN_A" "$fee" | head -1); want=$(awk -F'\t' '$1=="POOL-AFTER"{print $2" "$3}' "$S/$label/trade.txt")
    [ "$(cut -d' ' -f4,5 <<<"$st")" = "$want" ] || die "$label: MINED and the pool state $(cut -d' ' -f4,5 <<<"$st") differs from the quote's $want"
    # an ordinary trade pays the treasury its share like any other
    local wl; wl=$(grep '^QUOTE' "$S/$label/trade.txt" | grep -oE 'lore_fee=[0-9]+' | cut -d= -f2); LORE_EXPECTED=$((LORE_EXPECTED + wl))
    echo "NEUTRALIZED	$label	txid=$txid	mined as an ordinary trade: the fabricated claim did not survive the merge; pool_after=$(tr ' ' '/' <<<"$want") as quoted; the treasury received its $wl nicks" | tee "$S/$label.neutralized"
  fi
}
attack_neutral inflate-claim 106 --inflate-claim 1000000
attack mint 107 --successor-tokens "$((ATTACK_TOKENS + 1000))"
attack lore-short 111 --lore-short 1
attack lore-tokens 112 --lore-tokens 10
# the creator's key: alice signs the pool spend with her own key under a key lock
if [ "${RESUME:-0}" = 1 ] && [ -f "$S/creator-key.rejected" ]; then
  echo "RESUMED	creator-key already tested: $(head -1 "$S/creator-key.rejected")"
else
open_pool pool-creator-key "$TOKEN_A" 108 "$POOL_NOCK" "$ATTACK_TOKENS"; ATT_STEPS_A="$ATT_STEPS_A --step $OPEN_TXID:$OPEN_FILE"
funding_alice "$S/funding-ck.txt"; cb=$(coinbase_note "$S/funding-ck.txt" $((BUY_NICKS + 20000)) "$USED"); echo "$cb" >> "$USED"
r=$(user_tx alice "$S/creator-key-user" "[$cb]" "$BOB" "$BUY_NICKS")
APKH=$(awk -F'\t' '$1=="SIGHASH"{print $5; exit}' "${r#* }"); APUB=$(awk -F'\t' '$1=="SIGHASH"{print $4; exit}' "${r#* }")
trade creator-key alice "$TOKEN_A" 108 buy "${r%% *}" "${r#* }" "$BOB_LOCK" --witness-pkh "$APKH"
# also sign the pool spend itself with alice key
PSN="${POOL_NOTE_IN%% *}"; PD=$(awk -F'\t' -v n="$PSN" '$1=="NEWSIGHASH" && $2==n {print $3}' "$S/creator-key/trade.txt")
sign_hash alice "$PD" "$S/creator-key/pool.sig"
"$NMEME_TX" set-sig "$S/creator-key/final.jam" "$PSN" "$APKH" "$APUB" "$S/creator-key/pool.sig" "$S/creator-key/final-signed.jam" >/dev/null || die "creator-key: set-sig"
TRADE_FILE="$S/creator-key/final-signed.jam"; TRADE_TXID=$("$NMEME_INDEX" tx-id --tx "$TRADE_FILE")
expect_rejected "$TRADE_FILE" creator-key "$POOL_NOTE_IN" "$cb"
fi
donate() { # <label> <token> <fee> <nock> <tokens>: alice sends a second note to the pool lock
  local label="$1" token="$2" fee="$3" nock="$4" tokens="$5" d="$S/$1"; mkdir -p "$d" "$d/final"
  local tn; tn=$(token_note "$token"); local first="${tn%% *}" rest="${tn#* }" last held; last="${rest%% *}"; held="${rest#* }"
  local lock; lock=$(pool_lock "$token" "$fee")
  local tx; tx=$(create_tx alice "$d" "[$first $last]" "$BOB" "$nock")
  "$NMEME_TX" sighash "$tx" "$d" > "$d/sighash.txt" || die "$label: sighash"
  "$NMEME_TX" retarget "$tx" "$d/retargeted.jam" "$BOB_LOCK" "$lock" > "$d/retarget.txt" || die "$label: retarget"
  "$NMEME_TX" attach "$d/retargeted.jam" "$d/attached.jam" "$lock=transfer:$token:$tokens" "$ALICE_LOCK=transfer:$token:$((held - tokens))" > "$d/attach.txt" || die "$label: attach"
  resign alice "$d/sighash.txt" "$d/attached.jam" "$d/attach.txt" "$d/final.jam"
  DON_FILE="$d/final.jam"; DON_TXID=$(send "$DON_FILE" "$label"); confirm "$DON_TXID" "$label" "$DON_FILE"
  echo "DONATION	$label	txid=$DON_TXID	nock=$nock	tokens=$tokens	(a second note at the pool lock)"
}
# a second note at the lock, taken: alice donates to pool 109 then tries to take the donation with a buy
if [ "${RESUME:-0}" = 1 ] && [ -f "$S/take-donation.rejected" ]; then
  echo "RESUMED	take-donation already tested: $(head -1 "$S/take-donation.rejected")"
else
open_pool pool-merge "$TOKEN_A" 109 "$POOL_NOCK" "$ATTACK_TOKENS"; ATT_STEPS_A="$ATT_STEPS_A --step $OPEN_TXID:$OPEN_FILE"
donate donate-merge "$TOKEN_A" 109 100000 1000; ATT_STEPS_A="$ATT_STEPS_A --step $DON_TXID:$DON_FILE"
st=$(pool_state "$TOKEN_A" 109); [ "$(wc -l <<<"$st")" -eq 2 ] || die "merge: expected two notes at the lock, got: $st"
POOL_MAIN_NOTE=$(grep " $POOL_NOCK $ATTACK_TOKENS$" <<<"$st"); DON_NOTE=$(grep " 100000 1000$" <<<"$st")
funding_alice "$S/funding-merge.txt"; cb=$(coinbase_note "$S/funding-merge.txt" $((BUY_NICKS + 20000)) "$USED"); echo "$cb" >> "$USED"
r=$(user_tx alice "$S/take-donation-user" "[$cb]" "$BOB" "$BUY_NICKS")
d="$S/take-donation"; mkdir -p "$d"
"$NMEME_TX" pool-trade "${r%% *}" "$d/assembled.jam" --pool "$POOL_MAIN_NOTE" --token "$TOKEN_A" --fee-bps 109 $PP --side buy --placeholder "$BOB_LOCK" --dust "$DUST" --also-spend "$DON_NOTE" --also-take > "$d/trade.txt" 2>&1 || die "take-donation: $(tail -1 "$d/trade.txt")"
resign alice "${r#* }" "$d/assembled.jam" "$d/trade.txt" "$d/final.jam"
expect_rejected "$d/final.jam" take-donation "$(cut -d' ' -f1,2 <<<"$POOL_MAIN_NOTE")" "$(cut -d' ' -f1,2 <<<"$DON_NOTE")" "$cb"
fi

echo "== stage 6: a donation merged honestly (token A, pool 110) =="
if [ "${RESUME:-0}" = 1 ] && [ -f "$S/merge-ok.env" ]; then
  echo "RESUMED	merge-ok already mined: $(grep -h '^MERGED' "$RUN/pool-results.txt" 2>/dev/null | tail -1)"
else
open_pool pool-merge-ok "$TOKEN_A" 110 "$POOL_NOCK" "$ATTACK_TOKENS"; ATT_STEPS_A="$ATT_STEPS_A --step $OPEN_TXID:$OPEN_FILE"
donate donate-ok "$TOKEN_A" 110 100000 1000; ATT_STEPS_A="$ATT_STEPS_A --step $DON_TXID:$DON_FILE"
st=$(pool_state "$TOKEN_A" 110); POOL_MAIN_NOTE=$(grep " $POOL_NOCK $ATTACK_TOKENS$" <<<"$st"); DON_NOTE=$(grep " 100000 1000$" <<<"$st")
funding_alice "$S/funding-merge-ok.txt"; cb=$(coinbase_note "$S/funding-merge-ok.txt" $((BUY_NICKS + 20000)) "$USED"); echo "$cb" >> "$USED"
r=$(user_tx alice "$S/merge-ok-user" "[$cb]" "$BOB" "$BUY_NICKS")
d="$S/merge-ok"; mkdir -p "$d"
"$NMEME_TX" pool-trade "${r%% *}" "$d/assembled.jam" --pool "$POOL_MAIN_NOTE" --token "$TOKEN_A" --fee-bps 110 $PP --side buy --placeholder "$BOB_LOCK" --dust "$DUST" --also-spend "$DON_NOTE" > "$d/trade.txt" 2>&1 || die "merge-ok: $(tail -1 "$d/trade.txt")"
sed 's/^/  /' "$d/trade.txt" >&2
resign alice "${r#* }" "$d/assembled.jam" "$d/trade.txt" "$d/final.jam"
TRADE_FILE="$d/final.jam"; TRADE_TXID=$("$NMEME_INDEX" tx-id --tx "$TRADE_FILE")
sent=$(send "$TRADE_FILE" merge-ok); confirm "$TRADE_TXID" merge-ok "$TRADE_FILE"
st=$(pool_state "$TOKEN_A" 110); [ "$(wc -l <<<"$st")" -eq 1 ] || die "merge-ok: expected one note after the merge"
echo "MERGED	merge-ok	txid=$TRADE_TXID	pool_after=$(cut -d' ' -f4,5 <<<"$st" | tr ' ' '/')	(the donation is now reserves; the buy priced against the sum)"
wl=$(grep '^QUOTE' "$d/trade.txt" | grep -oE 'lore_fee=[0-9]+' | cut -d= -f2); LORE_EXPECTED=$((LORE_EXPECTED + wl))
lb=$(lore_balance); [ "${lb%% *}" = "$LORE_EXPECTED" ] || die "merge-ok: the Lore Wallet holds ${lb%% *} nicks, expected $LORE_EXPECTED"
echo "LORE	merge-ok	+$wl nicks	balance=$LORE_EXPECTED	notes=$(cut -d' ' -f2 <<<"$lb")	all_plain=$([ "${lb##* }" = 0 ] && echo yes || echo NO)"
ATT_STEPS_A="$ATT_STEPS_A --step $TRADE_TXID:$TRADE_FILE"
fi

echo "== stage 7: rebuild with provenance, replay the main pool =="
PROOFS=""; for f in "$S"/funding-*.txt.*; do [ -f "$f" ] && PROOFS="$PROOFS --funding $f"; done
for f in "$S"/funding-*.txt.lock; do [ -f "$f" ] && PROOFS="$PROOFS --funding $f"; done
[ -n "${LIVE_PROOFS:-}" ] && PROOFS="$PROOFS $LIVE_PROOFS"
# bob's plain notes came from alice's funding transactions: steps, so their provenance is a step's output
FUND_STEPS=""; for f in "$S"/fund-*.jam; do [ -f "$f" ] || continue; i="${f##*/fund-}"; i="${i%.jam}"; FUND_STEPS="$FUND_STEPS --step $(awk -F'\t' '$1=="TXID"{print $2}' "$S/send-fund-$i.txt"):$f"; done
# shellcheck disable=SC2086
"$NMEME_INDEX" rebuild --addr "$PUB" --token "$TOKEN_B" --step "$GTX_B:${GFILE_B:-$RUN/genesis-B/final.jam}" --step "$XTX_B:${XFILE_B:-$RUN/xfer-B/final.jam}" \
  $FUND_STEPS --step "$MAIN_OPEN_TXID:$MAIN_OPEN_FILE" $STEPS_B $PROOFS --scan-coinbase "$(node_height)" \
  --lock "$ALICE_LOCK" --lock "$BOB_LOCK" --lock "$MAIN_LOCK" --lock "$LORE_LOCK" \
  --expect-total "$SUPPLY" > "$S/balances-B.txt" || die "rebuild B failed: $(tail -3 "$S/balances-B.txt")"
grep -E "^(EVIDENCE|STEP|BALANCE|TOTAL|ASSERT)" "$S/balances-B.txt" | cut -c1-160
# shellcheck disable=SC2086
"$NMEME_INDEX" pool-replay --token "$TOKEN_B" --fee-bps "$FEE_BPS" $PP --open "$MAIN_OPEN_TXID:$MAIN_OPEN_FILE" $STEPS_B > "$S/replay-B.txt" || die "replay: $(tail -1 "$S/replay-B.txt")"
cat "$S/replay-B.txt"
live=$(pool_state "$TOKEN_B" "$FEE_BPS" | cut -d' ' -f4,5); rep=$(awk -F'\t' '$1=="STATE"{print $2" "$3}' "$S/replay-B.txt")
[ "$live" = "$rep" ] && echo "REPLAY-OK	live pool state $live equals the replayed state" || die "replay state $rep != live $live"
lb=$(lore_balance); lp=$(awk -F'\t' '$1=="STATE"{for(i=1;i<=NF;i++) if ($i ~ /^lore_paid_total=/) print substr($i,17)}' "$S/replay-B.txt")
# the balance beyond the main pool's total: the honest merge on pool 110, and a
# neutralized inflate-claim trade if one mined (no refused attack pays anything)
extra=$(( ${lb%% *} - lp ))
echo "LORE-FINAL	balance=${lb%% *} nicks	notes=$(cut -d' ' -f2 <<<"$lb")	non_plain=${lb##* }	replay_total_main_pool=$lp	other_pools=$extra (the merge-ok buy$([ -f "$S/inflate-claim.neutralized" ] && echo " and the neutralized inflate-claim trade"); no refused attack paid anything)"
echo "#### pool suite complete"
