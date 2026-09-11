#!/usr/bin/env bash
# swap-demo.sh — ONE instance of a token-for-NOCK trade between two wallets in
# a single transaction with output-source pins (docs/SWAPS.md), against the
# running fakenet node. MODE selects what is done with the assembled trade:
#
#   honest            send it, confirm it, rebuild the token with provenance
#   alice-half        Alice's spend alone
#   bob-half          Bob's spend alone
#   bob-pays-less     Bob's re-built, re-signed spend spliced into the trade Alice signed
#   alice-gives-less  Alice's re-built, re-signed spend spliced into the trade Bob signed
#
# Every attack MODE sends the tampered transaction to the node and requires
# the transaction engine's verdict, no inclusion after two blocks, and the
# inputs still unspent. Each instance uses its own token note and a fresh
# NOCK note for Bob, because the node keeps an admitted-but-invalid
# transaction's inputs reserved in its mempool (seen live: "Inputs present in
# spent-by, discarding transaction"), so instances must not share inputs.
# swap-suite.sh runs the five modes on five token notes.
#
# Stages: 1 fund Bob (plain, gated); 2 both halves from the stock wallet;
# 3 nmeme-tx swap (merge, claims, pins); 4 each party signs its own spend,
# the input gate reads the node live; 5 the MODE.
#
# Usage: MODE=... TOKEN=... TOKEN_NOTE="<first> <last>" TOKEN_HELD=... REPO=... RUN=... bash swap-demo.sh
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
MODE="${MODE:?set MODE (honest|alice-half|bob-half|bob-pays-less|alice-gives-less)}"
S="$RUN/swap/$MODE"; mkdir -p "$S" "$S/final" "$S/a" "$S/b"
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
    set +e; wallet_pub alice tx-status "$txid" >"$S/status-$label.txt" 2>&1; set -e
    if grep -qi "confirmed" "$S/status-$label.txt"; then
      local h; h=$(grep -oiE 'height[^0-9]*([0-9]+)' "$S/status-$label.txt" | grep -oE '[0-9]+' | head -1 || true)
      echo "HEIGHT=${h:-unknown}" > "$S/$label.env"; log "  $label confirmed at height ${h:-unknown}"; return 0
    fi
    sleep 15
  done
  die "$label: $txid not confirmed within ${INCLUDE_TIMEOUT:-900}s"
}
# send <file> <label> -> txid on stdout; the node's own answer is kept.
# The wallet's send-tx fetches the whole balance first and gives up when a
# block lands mid-fetch (seen live: "snapshot height drifted across pages"),
# so nothing reached the node. Submitting through the public gRPC directly
# is deterministic, and the node's accepted/rejected verdict is recorded.
send() {
  "$NMEME_INDEX" send --addr "$PUB" --tx "$1" >"$S/send-$2.txt" 2>&1 || true
  awk -F'\t' '$1=="TXID"{print $2}' "$S/send-$2.txt" | head -1
}
# unspent <first> <last>: is the note in the node's unspent set? (retries a
# read that failed on a moving tip)
unspent() {
  local i out
  for i in 1 2 3 4; do
    if out=$(quiet "$NMEME_INDEX" funding --addr "$PUB" --first "$1" 2>/dev/null); then
      grep -qF "$2" <<<"$out" && return 0 || return 1
    fi
    sleep 5
  done
  die "could not read the unspent set at $1"
}
# expect_rejected <file> <label> <input-name-1> <input-name-2>
# The node must not mine it: wait two blocks, then the inputs must still be
# unspent and tx-status must not say confirmed. The node's log lines about
# the transaction are recorded as the reason.
# expect_rejected <file> <label> <input-name>...
# Mempool admission is not validity (seen live): the node admits a
# transaction and then the transaction engine fails it with v1-tx-invalid
# every time the miner builds a block, it is excluded, and never mined. So
# the verdict is read where consensus decides: the engine's line in the
# node log, no block containing it after two more blocks, and every input
# still unspent.
expect_rejected() {
  local file="$1" label="$2"; shift 2
  local txid; txid=$("$NMEME_INDEX" tx-id --tx "$file")
  log "== attack: $label (txid $txid) =="
  "$NMEME_TX" pins "$file" > "$S/$label-pins.txt" 2>&1 || true
  sed 's/^/  /' "$S/$label-pins.txt" >&2
  local sent; sent=$(send "$file" "$label")
  sed 's/^/  node: /' "$S/send-$label.txt" >&2
  [ "$sent" = "$txid" ] || die "$label: the node was not asked about $txid (see $S/send-$label.txt)"
  local h0; h0=$(node_height)
  wait_for_height "$RUN/node.log" $((h0 + 2)) "${MINE_TIMEOUT:-900}" >/dev/null || die "$label: chain did not advance"
  set +e; wallet_pub alice tx-status "$txid" >"$S/status-$label.txt" 2>&1; set -e
  if grep -qi "confirmed" "$S/status-$label.txt"; then die "$label: the node MINED an invalid transaction"; fi
  local n
  for n in "$@"; do
    unspent "${n%% *}" "${n##* }" || die "$label: input [$n] is no longer unspent after the attack"
  done
  local engine
  engine=$(strip < "$RUN/node.log" | grep -a -A2 "heard-new-tx: Miner received new transaction: $txid" | grep -a -o -m1 "tx-acc: process failed: [a-z0-9-]*" || true)
  [ -n "$engine" ] || die "$label: the node log shows no transaction-engine verdict for $txid; inconclusive"
  echo "REJECTED	$label	txid=$txid	engine: ${engine#tx-acc: process failed: }	not mined in 2 blocks	inputs still unspent"
  echo "  mempool: $(awk -F'\t' '$1=="MEMPOOL"{print $2}' "$S/send-$label.txt"); pins: $(grep '^PINS' "$S/$label-pins.txt" | cut -f2-)"
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
# quiet <cmd...>: run a node read with the miner paused. At fakenet
# difficulty the miner lands a block every second or two, and a read that
# pages over a thousand notes never sees one block (seen live: page 0 at
# height 1116, page 2 at 1128, twelve attempts). Pausing the miner is what
# a real client cannot do; a real chain has 150 s blocks.
quiet() {
  kill -STOP "$MINER_PID" 2>/dev/null || true
  local rc=0
  "$@" || rc=$?
  kill -CONT "$MINER_PID" 2>/dev/null || true
  return $rc
}

echo "== stage 1: fund bob with NOCK (plain, gated) =="
quiet "$NMEME_INDEX" funding --addr "$PUB" $FUND_ARGS > "$S/funding-0.txt" || die "funding read"
FUND=$(awk -F'\t' -v need=$((BOB_FUND_NICKS + 20000)) '$1=="FUNDING" && $4=="coinbase" && $5+0>=need {print "["$2" "$3"]"; exit}' "$S/funding-0.txt")
[ -n "$FUND" ] || die "no verified coinbase note to fund bob from"
log "  funding from verified coinbase note $FUND"
FTX=$(create_tx alice "$S/fund" "$FUND" "$BOB" "$BOB_FUND_NICKS")
quiet "$NMEME_INDEX" check-inputs --addr "$PUB" --tx "$FTX" > "$S/fund/check-inputs.txt" 2>&1 || die "fund gate refused"
sed 's/^/  /' "$S/fund/check-inputs.txt" >&2
cp "$FTX" "$S/fund.jam"
FTXID=$(send "$S/fund.jam" fund); [ -n "$FTXID" ] || die "fund: no txid (see $S/send-fund.txt)"
grep -q "MEMPOOL	admitted" "$S/send-fund.txt" || die "fund: the mempool did not admit it"
confirm "$FTXID" fund
echo "FUND	txid=$FTXID	height=$(cut -d= -f2 "$S/fund.env")	bob+=$BOB_FUND_NICKS nicks"

echo "== stage 2: the halves =="
quiet "$NMEME_INDEX" funding --addr "$PUB" --lock "$BOB_LOCK" > "$S/funding-bob.txt" || die "bob funding read"
# The note this instance just funded (by origin height), never an older one:
# an earlier instance's invalid half may still hold an older note reserved
# in the mempool.
FUND_H=$(cut -d= -f2 "$S/fund.env")
BOB_NOTE=$(awk -F'\t' -v a="$BOB_FUND_NICKS" -v h="$FUND_H" '$1=="FUNDING" && $4=="plain" && $5==a && $6==h {print $2" "$3; exit}' "$S/funding-bob.txt")
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
quiet "$NMEME_INDEX" check-inputs --addr "$PUB" --tx "$S/swap.jam" --token-note "$TOKEN_NOTE" > "$S/swap-check-inputs.txt" 2>&1 || die "swap gate refused (see $S/swap-check-inputs.txt)"
sed 's/^/  /' "$S/swap-check-inputs.txt" >&2
SWAP_ID=$("$NMEME_INDEX" tx-id --tx "$S/swap.jam")
echo "SWAP-BUILT	txid=$SWAP_ID	$SELL tokens for $PRICE_NICKS nicks	pins=2"

echo "== stage 5: mode $MODE =="
case "$MODE" in
  alice-half)
    "$NMEME_TX" half "$S/swap.jam" "$A_SPEND" "$S/attack.jam" >/dev/null
    expect_rejected "$S/attack.jam" alice-half-alone "$TOKEN_NOTE" "$BOB_NOTE" ;;
  bob-half)
    "$NMEME_TX" half "$S/swap.jam" "$B_SPEND" "$S/attack.jam" >/dev/null
    expect_rejected "$S/attack.jam" bob-half-alone "$TOKEN_NOTE" "$BOB_NOTE" ;;
  bob-pays-less)
    # Bob's own re-built, re-signed spend (4 NOCK instead of 5), spliced into the trade Alice signed.
    B4=$(create_tx bob "$S/b4" "[$BOB_NOTE]" "$ALICE" $((PRICE_NICKS - 65536))); cp "$B4" "$S/b4.tx"
    build_swap "$S/a.tx" "$S/b4.tx" "$S/t-unsigned.jam" "$SELL" > "$S/t-build.txt" || die "tampered build"
    sign_spend bob "$S/t-unsigned.jam" "$B_SPEND" "$B_PKH" "$B_PK" "$S/t-bob-signed.jam" "$S/t-build.txt"
    "$NMEME_TX" replace-spend "$S/swap.jam" "$S/t-bob-signed.jam" "$B_SPEND" "$S/attack.jam" >/dev/null
    expect_rejected "$S/attack.jam" bob-pays-less "$TOKEN_NOTE" "$BOB_NOTE" ;;
  alice-gives-less)
    # Alice's re-built, re-signed spend (half the tokens), spliced into the trade Bob signed.
    build_swap "$S/a.tx" "$S/b.tx" "$S/t-unsigned.jam" $((SELL / 2)) > "$S/t-build.txt" || die "tampered build"
    sign_spend alice "$S/t-unsigned.jam" "$A_SPEND" "$A_PKH" "$A_PK" "$S/t-alice-signed.jam" "$S/t-build.txt"
    "$NMEME_TX" replace-spend "$S/swap.jam" "$S/t-alice-signed.jam" "$A_SPEND" "$S/attack.jam" >/dev/null
    expect_rejected "$S/attack.jam" alice-gives-less "$TOKEN_NOTE" "$BOB_NOTE" ;;
  honest)
    SENT=$(send "$S/swap.jam" swap); sed 's/^/  node: /' "$S/send-swap.txt" >&2
    [ -n "$SENT" ] || die "swap: the node was not asked (see $S/send-swap.txt)"
    grep -q "MEMPOOL	admitted" "$S/send-swap.txt" || die "swap: the mempool did not admit the honest trade"
    confirm "$SENT" swap
    SWAP_H=$(cut -d= -f2 "$S/swap.env")
    echo "SWAP	txid=$SENT	height=$SWAP_H	alice -$SELL tokens +$PRICE_NICKS nicks	bob +$SELL tokens -$PRICE_NICKS nicks"
    echo "== rebuild with provenance =="
    quiet "$NMEME_INDEX" funding --addr "$PUB" --lock "$ALICE_LOCK" --lock "$BOB_LOCK" > "$S/funding-after.txt" || die "funding after"
    STEPS="${STEPS:?set STEPS to the earlier --step args of the token}"
    PROOFS="${PROOFS:?set PROOFS to the --funding args covering the earlier steps}"
    quiet "$NMEME_INDEX" rebuild --addr "$PUB" --token "$TOKEN" $STEPS \
      --step "$FTXID:$S/fund.jam" --step "$SENT:$S/swap.jam" \
      --lock "$ALICE_LOCK" --lock "$BOB_LOCK" $PROOFS --funding "$S/funding-0.txt" \
      --expect "$ALICE_LOCK=$((TOKEN_HELD - SELL))" --expect "$BOB_LOCK=$((EXPECT_BOB_BEFORE + SELL))" \
      > "$S/balances.txt" 2>&1 || { cat "$S/balances.txt" >&2; die "rebuild"; }
    grep -E "^(EVIDENCE|STEP|BALANCE|TOTAL|ASSERT)" "$S/balances.txt"
    echo "== NOCK legs (the merged notes the trade created) =="
    awk -F'\t' -v h="$SWAP_H" '$1=="FUNDING" && $6==h {print "NOTE\t"$2"\t"$3"\t"$4"\t"$5" nicks\torigin "$6}' "$S/funding-after.txt" ;;
  *) die "unknown MODE $MODE" ;;
esac
