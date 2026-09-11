#!/usr/bin/env bash
# swap-demo.sh — a token-for-NOCK trade between two wallets in ONE transaction,
# with output-source pins (docs/SWAPS.md), against the running fakenet node.
#
# Runs after live-demo.sh on the same chain and wallets. Stages:
#   1  fund Bob with NOCK (a plain, gated transaction from Alice)
#   2  both parties build their halves with the stock wallet
#   3  nmeme-tx swap: merge, attach the token claims, pin both outputs
#   4  each party signs its own spend; the input gate reads the node live
#   5  the attacks, each sent to the node BEFORE the honest trade:
#        Alice's half alone, Bob's half alone,
#        Bob paying less (his re-signed spend spliced into Alice's signed one),
#        Alice giving less (her re-signed spend spliced into Bob's signed one)
#      each must be refused, and the inputs must still be unspent afterwards
#   6  the honest trade, mined
#   7  the rebuild: token balances with provenance, and the NOCK legs
#
# Usage: REPO=... RUN=... [FEE_NICKS=8192] bash swap-demo.sh 2>progress.log | tee results.txt
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/lib-verify.sh"
. "$HERE/lib-mine.sh"

REPO="${REPO:?set REPO to the nockchain checkout}"
RUN="${RUN:?set RUN to the run directory}"
W="$RUN/wallets"
PORT="${PORT:-25655}"   # node-lowmem.sh binds the private gRPC here
PUB="${PUBLIC_ADDR:-127.0.0.1:5556}"
WALLET="$REPO/target/release/nockchain-wallet"
MINER="$REPO/target/release/zk-pow-mine"
NMEME_TX="$REPO/target/debug/nmeme-tx"
NMEME_INDEX="$REPO/target/debug/nmeme-index"
S="$RUN/swap"; mkdir -p "$S"
: > "$RUN/verify.log"

log() { echo "$*" >&2; }
die() { echo "FAIL: $*" >&2; exit 1; }
strip() { sed 's/\x1b\[[0-9;]*m//g'; }
wallet() {
  local who="$1"; shift
  ( cd "$W/$who" && NOCKAPP_HOME="$W/$who" RUST_LOG=error "$WALLET" \
      --pma-initial-size 256MiB \
      --client private --private-grpc-server-port "$PORT" --fakenet "$@" )
}
wallet_pub() {
  local who="$1" cmd="$2"; shift 2
  ( cd "$W/$who" && NOCKAPP_HOME="$W/$who" RUST_LOG=error "$WALLET" --fakenet \
      --pma-initial-size 256MiB \
      "$cmd" --client public --public-grpc-server-addr "$PUB" "$@" )
}
sign_hash() {
  local who="$1" digest="$2" dest="$3" src="$W/$who/hash.sig"
  rm -f "$src"
  wallet "$who" sign-hash "$digest" >"$RUN/sign-$who.log" 2>&1 || die "sign-hash failed for $who"
  [ -s "$src" ] || die "sign-hash wrote nothing for $who"
  mv "$src" "$dest"
}
list_tx_files() {
  { find "$W/$1/txs" -type f -name '*.tx' 2>/dev/null || true
    find "$W/$1/wallet/txs" -type f -name '*.tx' 2>/dev/null || true; } | sort -u
}
verify_sig() {
  local out rc; set +e
  out=$(wallet "$1" verify-hash "$2" "$3" "$4" 2>&1); rc=$?; set -e
  out=$(printf '%s' "$out" | strip); printf '%s\n' "$out" >> "$RUN/verify.log"
  verify_decision "$rc" "$out"
}
verify_all() { # <sighash-file> <label>: every SIGHASH line, any wallet can verify
  local file="$1" label="$2" pass=0 total=0
  while IFS=$'\t' read -r tag name digest pubkey pkh sigfile; do
    [ "$tag" = "SIGHASH" ] || continue
    total=$((total+1))
    if verify_sig alice "$digest" "$sigfile" "$pubkey"; then echo "  PASS $label $name"; pass=$((pass+1))
    else echo "  FAIL $label $name"; fi
  done < "$file"
  echo "  $label: $pass/$total verified"
  [ "$total" -gt 0 ] && [ "$pass" -eq "$total" ] || die "$label: signature verification failed"
}
# create_tx <who> <dir> <names-or-empty> <recipient-addr> <amount>  -> prints the file
create_tx() {
  local who="$1" dir="$2" names="$3" to="$4" amount="$5"; mkdir -p "$dir"
  list_tx_files "$who" > "$dir/before.txt"
  if [ -n "$names" ]; then
    wallet "$who" create-tx --names "$names" \
      --recipient "{\"kind\":\"p2pkh\",\"address\":\"$to\",\"amount\":$amount}" \
      --fee-nicks "${FEE_NICKS:-8192}" --allow-low-fee >"$dir/create.txt" 2>&1 || die "create-tx failed for $who (see $dir/create.txt)"
  else
    wallet "$who" create-tx \
      --recipient "{\"kind\":\"p2pkh\",\"address\":\"$to\",\"amount\":$amount}" \
      --fee-nicks "${FEE_NICKS:-8192}" --allow-low-fee >"$dir/create.txt" 2>&1 || die "create-tx failed for $who (see $dir/create.txt)"
  fi
  # The wallet names the file by transaction id and prints the path; an
  # identical transaction (same inputs, outputs, fee) reuses the file, so a
  # before/after diff of the directory can be empty on a rerun.
  local saved; saved=$(strip < "$dir/create.txt" | grep -oE 'txs/[0-9A-Za-z]+\.tx' | head -1 || true)
  if [ -n "$saved" ] && [ -s "$W/$who/$saved" ]; then echo "$W/$who/$saved"; return 0; fi
  list_tx_files "$who" > "$dir/after.txt"
  comm -13 "$dir/before.txt" "$dir/after.txt" > "$dir/new.txt"
  [ "$(wc -l < "$dir/new.txt")" -eq 1 ] || die "$who: expected exactly one new transaction file (see $dir/create.txt)"
  head -1 "$dir/new.txt"
}
node_height() { wait_for_height "$RUN/node.log" 0 10; }
# confirm <txid> <label> -> HEIGHT in $S/<label>.env
confirm() {
  local txid="$1" label="$2" deadline=$((SECONDS + ${INCLUDE_TIMEOUT:-900}))
  while (( SECONDS < deadline )); do
    set +e; wallet_pub alice tx-status "$txid" >"$RUN/status-$label.txt" 2>&1; set -e
    if grep -qi "confirmed" "$RUN/status-$label.txt"; then
      local h; h=$(grep -oiE 'height[^0-9]*([0-9]+)' "$RUN/status-$label.txt" | grep -oE '[0-9]+' | head -1 || true)
      echo "HEIGHT=${h:-unknown}" > "$S/$label.env"; log "  $label confirmed at height ${h:-unknown}"; return 0
    fi
    sleep 15
  done
  die "$label: $txid not confirmed within ${INCLUDE_TIMEOUT:-900}s"
}
send() { # send <file> <label> -> txid on stdout, send-tx output kept
  wallet_pub alice send-tx "$1" >"$RUN/send-$2.txt" 2>&1 || true
  grep -oE '[0-9A-Za-z]{40,}' "$RUN/send-$2.txt" | head -1 || true
}
# expect_rejected <file> <label> <input-name-1> <input-name-2>
# The node must not mine it: wait two blocks, then the inputs must still be
# unspent and tx-status must not say confirmed. The node's log lines about
# the transaction are recorded as the reason.
expect_rejected() {
  local file="$1" label="$2"; shift 2
  local txid; txid=$("$NMEME_INDEX" tx-id --tx "$file")
  log "== attack: $label (txid $txid) =="
  "$NMEME_TX" pins "$file" > "$S/$label-pins.txt" 2>&1 || true
  sed 's/^/  /' "$S/$label-pins.txt" >&2
  local sent; sent=$(send "$file" "$label")
  strip < "$RUN/send-$label.txt" | tail -3 | sed 's/^/  send-tx: /' >&2
  local h0; h0=$(node_height)
  wait_for_height "$RUN/node.log" $((h0 + 2)) "${MINE_TIMEOUT:-900}" >/dev/null || die "$label: chain did not advance"
  set +e; wallet_pub alice tx-status "$txid" >"$RUN/status-$label.txt" 2>&1; set -e
  if grep -qi "confirmed" "$RUN/status-$label.txt"; then die "$label: the node MINED an invalid transaction"; fi
  local n
  for n in "$@"; do
    "$NMEME_INDEX" funding --addr "$PUB" --first "${n%% *}" 2>/dev/null | grep -qF "${n##* }" \
      || die "$label: input [$n] is no longer unspent after the attack"
  done
  local reason; reason=$(strip < "$RUN/node.log" | grep -a -A3 "$txid" | grep -a -i -m1 "invalid\|reject\|fail\|bad\|error" | cut -c1-200 || true)
  echo "REJECTED	$label	txid=$txid	inputs still unspent after 2 blocks	${reason:-node log: no line for this txid}"
  echo "  pins: $(grep '^PINS' "$S/$label-pins.txt" | cut -f2-)"
}

ALICE=$(wallet alice list-active-addresses | strip | grep -oE '^- Address: .*' | head -1 | sed 's/^- Address: //')
BOB=$(wallet bob list-active-addresses | strip | grep -oE '^- Address: .*' | head -1 | sed 's/^- Address: //')
[ -n "$ALICE" ] && [ -n "$BOB" ] || die "wallet addresses"
ALICE_LOCK="${ALICE_LOCK:?set ALICE_LOCK to the p2pkh lock-root of alice}"
BOB_LOCK="${BOB_LOCK:?set BOB_LOCK to the p2pkh lock-root of bob}"
TOKEN="${TOKEN:?set TOKEN (the token id to trade)}"
TOKEN_NOTE="${TOKEN_NOTE:?set TOKEN_NOTE to the token note alice holds, as <first> <last>}"
TOKEN_HELD="${TOKEN_HELD:?set TOKEN_HELD to the amount that note carries}"
FUND_ARGS="${FUND_ARGS:?set FUND_ARGS to the --lock and --first args the coinbase notes of alice are read at}"
SELL="${SELL:-100}"; PRICE_NICKS="${PRICE_NICKS:-327680}"   # 100 tokens for 5 NOCK
BOB_FUND_NICKS="${BOB_FUND_NICKS:-655360}"                   # 10 NOCK
DUST="${DUST:-1000}"

echo "== stage 0: miner =="
"$MINER" --node-addr "http://127.0.0.1:$PORT" --mining-pkh "$ALICE" --num-threads 1 >"$RUN/miner.log" 2>&1 &
MINER_PID=$!; trap 'kill "$MINER_PID" 2>/dev/null || true' EXIT
echo "miner pid=$MINER_PID"

echo "== stage 1: fund bob with NOCK (plain, gated) =="
"$NMEME_INDEX" funding --addr "$PUB" $FUND_ARGS > "$S/funding-0.txt" || die "funding read"
FUND=$(awk -F'\t' -v need=$((BOB_FUND_NICKS + 20000)) '$1=="FUNDING" && $4=="coinbase" && $5+0>=need {print "["$2" "$3"]"; exit}' "$S/funding-0.txt")
[ -n "$FUND" ] || die "no verified coinbase note to fund bob from"
log "  funding from verified coinbase note $FUND"
FTX=$(create_tx alice "$S/fund" "$FUND" "$BOB" "$BOB_FUND_NICKS")
"$NMEME_INDEX" check-inputs --addr "$PUB" --tx "$FTX" > "$S/fund/check-inputs.txt" 2>&1 || die "fund gate refused"
sed 's/^/  /' "$S/fund/check-inputs.txt" >&2
cp "$FTX" "$S/fund.jam"
FTXID=$(send "$S/fund.jam" fund); [ -n "$FTXID" ] || die "fund: no txid"
confirm "$FTXID" fund
echo "FUND	txid=$FTXID	height=$(cut -d= -f2 "$S/fund.env")	bob+=$BOB_FUND_NICKS nicks"

echo "== stage 2: the halves =="
"$NMEME_INDEX" funding --addr "$PUB" --lock "$BOB_LOCK" > "$S/funding-bob.txt" || die "bob funding read"
BOB_NOTE=$(awk -F'\t' -v a="$BOB_FUND_NICKS" '$1=="FUNDING" && $4=="plain" && $5==a {print $2" "$3; exit}' "$S/funding-bob.txt")
[ -n "$BOB_NOTE" ] || die "bob's NOCK note not found"
log "  bob pays from [$BOB_NOTE] (plain, no claim)"
ATX=$(create_tx alice "$S/a" "[$TOKEN_NOTE]" "$BOB" "$DUST");   cp "$ATX" "$S/a.tx"
BTX=$(create_tx bob   "$S/b" "[$BOB_NOTE]"   "$ALICE" "$PRICE_NICKS"); cp "$BTX" "$S/b.tx"
"$NMEME_TX" sighash "$S/a.tx" "$S/a" > "$S/a/sighash.txt" || die "a sighash"; verify_all "$S/a/sighash.txt" "alice-half-wallet"
"$NMEME_TX" sighash "$S/b.tx" "$S/b" > "$S/b/sighash.txt" || die "b sighash"; verify_all "$S/b/sighash.txt" "bob-half-wallet"
A_SPEND=$(awk -F'\t' '$1=="SIGHASH"{print $2; exit}' "$S/a/sighash.txt"); A_PK=$(awk -F'\t' '$1=="SIGHASH"{print $4; exit}' "$S/a/sighash.txt"); A_PKH=$(awk -F'\t' '$1=="SIGHASH"{print $5; exit}' "$S/a/sighash.txt")
B_SPEND=$(awk -F'\t' '$1=="SIGHASH"{print $2; exit}' "$S/b/sighash.txt"); B_PK=$(awk -F'\t' '$1=="SIGHASH"{print $4; exit}' "$S/b/sighash.txt"); B_PKH=$(awk -F'\t' '$1=="SIGHASH"{print $5; exit}' "$S/b/sighash.txt")

# build_swap <a.tx> <b.tx> <out> <sell> -> attaches claims and pins both locks
build_swap() {
  local a="$1" b="$2" out="$3" sell="$4"
  local keep=$((TOKEN_HELD - sell))
  NMEME_FEE_HEIGHT="$(node_height)" "$NMEME_TX" swap "$a" "$b" "$out" \
    --claim "$BOB_LOCK=transfer:$TOKEN:$sell" --claim "$ALICE_LOCK=transfer:$TOKEN:$keep" \
    --pin-a "$ALICE_LOCK" --pin-b "$BOB_LOCK"
}
sign_spend() { # <who> <tx-in> <spend-first> <pkh> <pubkey> <tx-out> <build-output-file>
  local who="$1" in="$2" spend="$3" pkh="$4" pk="$5" out="$6" built="$7"
  local digest; digest=$(awk -F'\t' -v s="$spend" '$1=="NEWSIGHASH" && $2==s {print $3}' "$built")
  [ -n "$digest" ] || die "no digest for spend $spend"
  sign_hash "$who" "$digest" "$S/$who-$(basename "$out").sig"
  "$NMEME_TX" set-sig "$in" "$spend" "$pkh" "$pk" "$S/$who-$(basename "$out").sig" "$out" >/dev/null || die "set-sig $who"
}

echo "== stage 3: merge, attach claims, pin =="
build_swap "$S/a.tx" "$S/b.tx" "$S/swap-unsigned.jam" "$SELL" > "$S/swap-build.txt" || die "swap build failed: $(tail -1 "$S/swap-build.txt")"
sed 's/^/  /' "$S/swap-build.txt" >&2
echo "== stage 4: both parties sign their own spend; gate live =="
sign_spend alice "$S/swap-unsigned.jam" "$A_SPEND" "$A_PKH" "$A_PK" "$S/swap-a-signed.jam" "$S/swap-build.txt"
sign_spend bob   "$S/swap-a-signed.jam" "$B_SPEND" "$B_PKH" "$B_PK" "$S/swap.jam"          "$S/swap-build.txt"
"$NMEME_TX" sighash "$S/swap.jam" "$S/final" > "$S/swap-sighash.txt" || die "swap sighash"
verify_all "$S/swap-sighash.txt" "swap-both-spends"
"$NMEME_TX" pins "$S/swap.jam" | sed 's/^/  /' >&2
"$NMEME_INDEX" check-inputs --addr "$PUB" --tx "$S/swap.jam" --token-note "$TOKEN_NOTE" > "$S/swap-check-inputs.txt" 2>&1 || die "swap gate refused (see $S/swap-check-inputs.txt)"
sed 's/^/  /' "$S/swap-check-inputs.txt" >&2
SWAP_ID=$("$NMEME_INDEX" tx-id --tx "$S/swap.jam")
echo "SWAP-BUILT	txid=$SWAP_ID	$SELL tokens for $PRICE_NICKS nicks	pins=2"

echo "== stage 5: the attacks, before the honest trade =="
"$NMEME_TX" half "$S/swap.jam" "$A_SPEND" "$S/attack-alice-half.jam" >/dev/null
expect_rejected "$S/attack-alice-half.jam" alice-half-alone "$TOKEN_NOTE" "$BOB_NOTE"
"$NMEME_TX" half "$S/swap.jam" "$B_SPEND" "$S/attack-bob-half.jam" >/dev/null
expect_rejected "$S/attack-bob-half.jam" bob-half-alone "$TOKEN_NOTE" "$BOB_NOTE"
# Bob pays less: his own re-built, re-signed spend spliced into the trade Alice signed.
B4=$(create_tx bob "$S/b4" "[$BOB_NOTE]" "$ALICE" $((PRICE_NICKS - 65536))); cp "$B4" "$S/b4.tx"
build_swap "$S/a.tx" "$S/b4.tx" "$S/t1-unsigned.jam" "$SELL" > "$S/t1-build.txt" || die "t1 build"
sign_spend bob "$S/t1-unsigned.jam" "$B_SPEND" "$B_PKH" "$B_PK" "$S/t1-bob-signed.jam" "$S/t1-build.txt"
"$NMEME_TX" replace-spend "$S/swap.jam" "$S/t1-bob-signed.jam" "$B_SPEND" "$S/attack-bob-pays-less.jam" >/dev/null
expect_rejected "$S/attack-bob-pays-less.jam" bob-pays-less "$TOKEN_NOTE" "$BOB_NOTE"
# Alice gives less: her re-built, re-signed spend spliced into the trade Bob signed.
build_swap "$S/a.tx" "$S/b.tx" "$S/t2-unsigned.jam" $((SELL / 2)) > "$S/t2-build.txt" || die "t2 build"
sign_spend alice "$S/t2-unsigned.jam" "$A_SPEND" "$A_PKH" "$A_PK" "$S/t2-alice-signed.jam" "$S/t2-build.txt"
"$NMEME_TX" replace-spend "$S/swap.jam" "$S/t2-alice-signed.jam" "$A_SPEND" "$S/attack-alice-gives-less.jam" >/dev/null
expect_rejected "$S/attack-alice-gives-less.jam" alice-gives-less "$TOKEN_NOTE" "$BOB_NOTE"

echo "== stage 6: the honest trade =="
SENT=$(send "$S/swap.jam" swap); strip < "$RUN/send-swap.txt" | tail -3 >&2
[ -n "$SENT" ] || die "swap: send-tx gave no txid"
confirm "$SENT" swap
SWAP_H=$(cut -d= -f2 "$S/swap.env")
echo "SWAP	txid=$SENT	height=$SWAP_H	alice -$SELL tokens +$PRICE_NICKS nicks	bob +$SELL tokens -$PRICE_NICKS nicks"

echo "== stage 7: rebuild with provenance =="
"$NMEME_INDEX" funding --addr "$PUB" --lock "$ALICE_LOCK" --lock "$BOB_LOCK" > "$S/funding-after.txt" || die "funding after"
STEPS="${STEPS:?set STEPS to the earlier --step args of the token}"
PROOFS="${PROOFS:?set PROOFS to the --funding args covering the earlier steps}"
"$NMEME_INDEX" rebuild --addr "$PUB" --token "$TOKEN" $STEPS \
  --step "$FTXID:$S/fund.jam" --step "$SENT:$S/swap.jam" \
  --lock "$ALICE_LOCK" --lock "$BOB_LOCK" $PROOFS --funding "$S/funding-0.txt" \
  --expect "$ALICE_LOCK=$((TOKEN_HELD - SELL))" --expect "$BOB_LOCK=$((EXPECT_BOB_BEFORE + SELL))" \
  > "$S/balances.txt" 2>&1 || { cat "$S/balances.txt" >&2; die "rebuild"; }
grep -E "^(EVIDENCE|STEP|BALANCE|TOTAL|ASSERT)" "$S/balances.txt"
echo "== NOCK legs (assets of the merged notes) =="
awk -F'\t' -v h="$SWAP_H" '$1=="FUNDING" && $6==h {print "NOTE\t"$2"\t"$3"\t"$4"\t"$5" nicks\torigin "$6}' "$S/funding-after.txt"
echo "== summary =="
echo "one transaction, two spends, two pins: $SELL tokens moved to bob, $PRICE_NICKS nicks moved to alice; four attacks refused, inputs intact until the honest trade."
