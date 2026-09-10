#!/usr/bin/env bash
# Live NMEME demonstration on a local fakenet chain.
#
#   1  two fresh wallets, isolated by NOCKAPP_HOME
#   2  mine to Alice until she has a spendable note
#   3  build an ordinary transaction with the wallet
#   4  GATE: verify the Rust sig-hash against the wallet's own signature
#   5  genesis: attach a claim, re-sign, verify, broadcast, confirm
#   6  transfer: move part of the supply to Bob, same path
#   7  rebuild balances from the canonical chain
#
# Stage 4 is a gate. If the Rust digest disagrees with the wallet's, everything
# after it produces signatures a node rejects for reasons that read like fee or
# networking faults. Nothing proceeds past a failed gate.
#
# Every wallet call pins --client private to the LOCAL node: the CLI's default
# endpoint is a public node.
set -euo pipefail

REPO="${REPO:?set REPO to the nockchain checkout}"
RUN="${RUN:?set RUN to a working directory}"
PORT="${PORT:-25655}"
WALLET="$REPO/target/release/nockchain-wallet"
NMEME_TX="$REPO/target/debug/nmeme-tx"
NMEME_INDEX="$REPO/target/debug/nmeme-index"
MINER="$REPO/target/release/zk-pow-mine"
W="$RUN/wallets"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

. "$HERE/lib-verify.sh"

# Progress goes to stderr; only transaction results go to stdout and to
# result files. An earlier version returned the txid through stdout while also
# echoing progress there, so the caller captured a progress line as the txid.
log() { echo "$*" >&2; }
die() { echo "FAIL: $*" >&2; exit 1; }
strip() { sed 's/\x1b\[[0-9;]*m//g'; }

# Wallet runs with cwd = the wallet dir, because sign-hash writes its output to
# a fixed relative filename (hash.sig, wallet.hoon:1996).
wallet() {
  local who="$1"; shift
  ( cd "$W/$who" && NOCKAPP_HOME="$W/$who" RUST_LOG=error "$WALLET" \
      --client private --private-grpc-server-port "$PORT" --fakenet "$@" )
}

# send-tx, tx-status and tx-accepted each declare their OWN --client option,
# defaulting to `public` with a hard-coded internet address
# (23.252.122.18:5556). A global --client private is shadowed by that
# subcommand-level default, so those three were being sent to the public
# internet node. They are routed here to the LOCAL public gRPC bind instead.
wallet_pub() {
  local who="$1" cmd="$2"; shift 2
  ( cd "$W/$who" && NOCKAPP_HOME="$W/$who" RUST_LOG=error "$WALLET" --fakenet \
      "$cmd" --client public --public-grpc-server-addr "${PUBLIC_ADDR:-127.0.0.1:5556}" "$@" )
}

# sign_hash <who> <digest> <dest.jam>
# The wallet always writes to $W/<who>/hash.sig. Locating it by mtime, or by
# globbing for the newest .jam, picks up unrelated files; use the documented
# path and move it somewhere unique.
sign_hash() {
  local who="$1" digest="$2" dest="$3"
  local src="$W/$who/hash.sig"
  rm -f "$src"
  wallet "$who" sign-hash "$digest" >"$RUN/sign-$who.log" 2>&1 \
    || die "sign-hash failed for $who (see $RUN/sign-$who.log)"
  [ -s "$src" ] || die "sign-hash reported success but $src is missing or empty"
  mv "$src" "$dest"
}

# Every place the wallet may write a transaction file.
list_tx_files() {
  local who="$1"
  { find "$W/$who/txs" -type f -name '*.tx' 2>/dev/null || true
    find "$W/$who/wallet/txs" -type f -name '*.tx' 2>/dev/null || true
  } | sort -u
}

verify_sig() { # verify_sig <who> <digest> <sigfile> <pubkey>
  local out rc
  set +e
  out=$(wallet "$1" verify-hash "$2" "$3" "$4" 2>&1); rc=$?
  set -e
  out=$(printf '%s' "$out" | strip)
  printf '%s\n' "$out" >> "$RUN/verify.log"
  verify_decision "$rc" "$out"
}

# verify_all <who> <sighash-file> <label>
# Every SIGHASH line must pass, and there must be at least one. A loop that
# silently iterates zero times would otherwise read as success.
verify_all() {
  local who="$1" file="$2" label="$3"
  local pass=0 total=0
  while IFS=$'\t' read -r tag name digest pubkey pkh sigfile; do
    [ "$tag" = "SIGHASH" ] || continue
    total=$((total+1))
    if verify_sig "$who" "$digest" "$sigfile" "$pubkey"; then
      echo "  PASS $label $name"; pass=$((pass+1))
    else
      echo "  FAIL $label $name — digest does not match the signature"
    fi
  done < "$file"
  echo "  $label: $pass/$total verified"
  [ "$total" -gt 0 ] || die "$label: no signatures to verify"
  [ "$pass" -eq "$total" ] || die "$label: $((total-pass)) signature(s) failed"
}

mkdir -p "$RUN" "$W/alice" "$W/bob" "$RUN/sig" "$RUN/final" "$RUN/xfer"
: > "$RUN/verify.log"

echo "== stage 1: wallets =="
for who in alice bob; do
  if [ ! -f "$W/$who/.done" ]; then
    wallet "$who" keygen >/dev/null 2>&1 || die "keygen failed for $who"
    touch "$W/$who/.done"
  fi
done
ALICE=$(wallet alice list-active-addresses | strip | grep -oE '^- Address: .*' | head -1 | sed 's/^- Address: //')
BOB=$(wallet bob list-active-addresses | strip | grep -oE '^- Address: .*' | head -1 | sed 's/^- Address: //')
[ -n "$ALICE" ] && [ -n "$BOB" ] || die "could not read wallet addresses"
echo "alice=$ALICE"
echo "bob=$BOB"

echo "== stage 2: mine to alice =="
"$MINER" --node-addr "http://127.0.0.1:$PORT" --mining-pkh "$ALICE" --num-threads 1 \
  >"$RUN/miner.log" 2>&1 &
MINER_PID=$!
trap 'kill "$MINER_PID" 2>/dev/null || true' EXIT
echo "miner pid=$MINER_PID"

HEIGHT=""
DEADLINE=$((SECONDS + ${MINE_TIMEOUT:-1800}))
while (( SECONDS < DEADLINE )); do
  HEIGHT=$(grep -ao "added to validated blocks at [0-9]*" "$RUN/node.log" 2>/dev/null \
           | tail -1 | grep -oE '[0-9]+$' || true)
  [ -n "$HEIGHT" ] && [ "$HEIGHT" -ge "${MIN_HEIGHT:-3}" ] && break
  sleep 10
done
[ -n "$HEIGHT" ] || die "no block mined within ${MINE_TIMEOUT:-1800}s"
echo "height=$HEIGHT"

# broadcast_and_confirm <tx.jam> <label> <result-file>
# Writes TXID= and HEIGHT= to the result file. Nothing is returned through
# stdout, so no caller has to disentangle results from progress, and no
# subshell swallows a failure.
broadcast_and_confirm() {
  local tx="$1" label="$2" result="$3"
  wallet_pub alice send-tx "$tx" >"$RUN/send-$label.txt" 2>&1 \
    || die "send-tx failed for $label (see $RUN/send-$label.txt)"
  strip < "$RUN/send-$label.txt" | tail -5 >&2

  local txid
  txid=$(grep -oE '[0-9A-Za-z]{40,}' "$RUN/send-$label.txt" | head -1 || true)
  [ -n "$txid" ] || die "$label: no transaction id in send-tx output"
  log "  txid=$txid"

  local deadline=$((SECONDS + ${INCLUDE_TIMEOUT:-900}))
  while (( SECONDS < deadline )); do
    set +e
    wallet_pub alice tx-status "$txid" >"$RUN/status-$label.txt" 2>&1
    set -e
    if grep -qi "confirmed" "$RUN/status-$label.txt"; then
      local h
      h=$(grep -oiE 'height[^0-9]*([0-9]+)' "$RUN/status-$label.txt" \
          | grep -oE '[0-9]+' | head -1 || true)
      { echo "TXID=$txid"; echo "HEIGHT=${h:-unknown}"; } > "$result"
      log "  confirmed at height ${h:-unknown}"
      return 0
    fi
    sleep 15
  done
  die "$label: transaction $txid not confirmed within ${INCLUDE_TIMEOUT:-900}s"
}

# build_sign_send <label> <recipient> <amount> <result-file> [--names <names>] <lock=claim>...
# Called directly, never in $( ), so die() actually stops the script.
build_sign_send() {
  local label="$1" to="$2" amount="$3" result="$4"; shift 4
  local names=""
  if [ "${1:-}" = "--names" ]; then names="$2"; shift 2; fi
  local dir="$RUN/$label"; mkdir -p "$dir" "$dir/final"

  local tx
  list_tx_files alice > "$dir/tx-before.txt"
  if [ -n "$names" ]; then
    log "  spending note(s): $names"
    wallet alice create-tx --names "$names" \
      --recipient "{\"kind\":\"p2pkh\",\"address\":\"$to\",\"amount\":$amount}" \
      --fee-nicks "${FEE_NICKS:-4096}" --allow-low-fee >"$dir/create.txt" 2>&1 \
      || die "$label: create-tx failed (see $dir/create.txt)"
  else
    wallet alice create-tx \
      --recipient "{\"kind\":\"p2pkh\",\"address\":\"$to\",\"amount\":$amount}" \
      --fee-nicks "${FEE_NICKS:-4096}" --allow-low-fee >"$dir/create.txt" 2>&1 \
      || die "$label: create-tx failed (see $dir/create.txt)"
  fi
  list_tx_files alice > "$dir/tx-after.txt"
  comm -13 "$dir/tx-before.txt" "$dir/tx-after.txt" > "$dir/tx-new.txt"
  local count; count=$(wc -l < "$dir/tx-new.txt")
  [ "$count" -eq 1 ] || die "$label: expected exactly 1 new transaction file, got $count"
  tx=$(head -1 "$dir/tx-new.txt")
  [ -s "$tx" ] || die "$label: transaction file $tx missing or empty"
  log "  tx=$tx"

  "$NMEME_TX" sighash "$tx" "$dir" >"$dir/sighash.txt" \
    || die "$label: sighash failed (unsigned transaction?)"
  verify_all alice "$dir/sighash.txt" "$label-gate"

  "$NMEME_TX" seeds "$tx" >"$dir/seeds.txt" || die "$label: seeds failed"
  grep -q '^MERGED' "$dir/seeds.txt" && die "$label: two seeds share a lock-root"

  # Every lock-root named in a claim must actually be paid by this transaction.
  local spec
  for spec in "$@"; do
    local lock="${spec%%=*}"
    grep -qF "$lock" "$dir/seeds.txt" \
      || die "$label: no seed pays lock-root $lock (claims must match outputs)"
    log "  verified output lock-root $lock"
  done

  # attach computes the post-claim minimum fee with the repository's own
  # estimator and refuses if the wallet-chosen fee is below it. FEE_NICKS
  # defaults to 4096 (0.0625 NOCK on fakenet) to clear it; the FEE line shows
  # the actual numbers and a refusal names the shortfall.
  NMEME_FEE_HEIGHT="${HEIGHT:-1}" "$NMEME_TX" attach "$tx" "$dir/attached.jam" "$@" >"$dir/attach.txt" \
    || die "$label: attach refused (fee or claim): $(tail -1 "$dir/attach.txt" 2>/dev/null)"
  grep '^FEE' "$dir/attach.txt" >&2 || die "$label: attach reported no fee line"
  local newhash spendname
  newhash=$(awk -F'\t' '$1=="NEWSIGHASH"{print $3}' "$dir/attach.txt" | head -1)
  spendname=$(awk -F'\t' '$1=="NEWSIGHASH"{print $2}' "$dir/attach.txt" | head -1)
  [ -n "$newhash" ] && [ -n "$spendname" ] || die "$label: attach produced no digest"
  log "  new sig-hash=$newhash"

  sign_hash alice "$newhash" "$dir/new.sig"

  local pubkey pkh
  pubkey=$(awk -F'\t' '$1=="SIGHASH"{print $4}' "$dir/sighash.txt" | head -1)
  pkh=$(awk -F'\t' '$1=="SIGHASH"{print $5}' "$dir/sighash.txt" | head -1)
  "$NMEME_TX" set-sig "$dir/attached.jam" "$spendname" "$pkh" "$pubkey" "$dir/new.sig" \
    "$dir/final.jam" >>"$dir/attach.txt" || die "$label: set-sig failed"

  "$NMEME_TX" sighash "$dir/final.jam" "$dir/final" >"$dir/final-sighash.txt" \
    || die "$label: sighash of the re-signed transaction failed"
  verify_all alice "$dir/final-sighash.txt" "$label-resigned"

  broadcast_and_confirm "$dir/final.jam" "$label" "$result"
}

log "== stage 5: genesis =="
# The genesis transaction pays Bob a little NOCK; Alice's change seed carries
# the whole token supply.
"$NMEME_TX" seeds /dev/null >/dev/null 2>&1 || true
mkdir -p "$RUN/genesis"
list_tx_files alice > "$RUN/genesis/probe-before.txt"
wallet alice create-tx \
  --recipient "{\"kind\":\"p2pkh\",\"address\":\"$BOB\",\"amount\":${SEND_NICKS:-1000}}" \
  --fee-nicks "${FEE_NICKS:-4096}" --allow-low-fee >"$RUN/genesis/probe.txt" 2>&1 \
  || die "probe create-tx failed"
list_tx_files alice > "$RUN/genesis/probe-after.txt"
comm -13 "$RUN/genesis/probe-before.txt" "$RUN/genesis/probe-after.txt" > "$RUN/genesis/probe-new.txt"
PROBE=$(head -1 "$RUN/genesis/probe-new.txt")
[ -s "$PROBE" ] || die "probe produced no transaction"
"$NMEME_TX" seeds "$PROBE" > "$RUN/genesis/probe-seeds.txt" || die "probe seeds failed"
ALICE_LOCK=$(awk -F'\t' '$1=="SEED"{print $4"\t"$3}' "$RUN/genesis/probe-seeds.txt" | sort -rn | head -1 | cut -f2)
BOB_LOCK=$(awk -F'\t' '$1=="SEED"{print $4"\t"$3}' "$RUN/genesis/probe-seeds.txt" | sort -n | head -1 | cut -f2)
[ -n "$ALICE_LOCK" ] && [ -n "$BOB_LOCK" ] || die "could not resolve lock-roots"
[ "$ALICE_LOCK" != "$BOB_LOCK" ] || die "alice and bob resolved to the same lock-root"
log "alice lock-root=$ALICE_LOCK"
log "bob   lock-root=$BOB_LOCK"
rm -f "$PROBE"

build_sign_send genesis "$BOB" "${SEND_NICKS:-1000}" "$RUN/genesis.env" \
  "$ALICE_LOCK=genesis:${TICKER:-DOGE}:6:${SUPPLY:-1000000}"
. "$RUN/genesis.env"
GENESIS_TXID="$TXID"; GENESIS_HEIGHT="$HEIGHT"
echo "GENESIS txid=$GENESIS_TXID height=$GENESIS_HEIGHT"

TOKEN=$("$NMEME_INDEX" token-id --tx "$RUN/genesis/final.jam" \
  --ticker "${TICKER:-DOGE}" --decimals 6) || die "could not derive token id"
echo "TOKEN $TOKEN"

log "== stage 6: transfer 100 to bob, 999900 back to alice =="
# Spend the token-bearing note EXPLICITLY. Auto-selection would either miss it
# or spend it with no claim attached, which burns the supply (SPEC §7).
"$NMEME_INDEX" token-note --addr "${PUBLIC_ADDR:-127.0.0.1:5556}" \
  --address "$ALICE" --lock "$ALICE_LOCK" > "$RUN/token-note.txt" \
  || die "could not find alice's token-bearing note"
cat "$RUN/token-note.txt" >&2
TOKEN_NOTE=$(awk -F'\t' '$1=="NOTE"{print $2}' "$RUN/token-note.txt")
[ -n "$TOKEN_NOTE" ] || die "no token note name"

XFER_TO_BOB="${XFER_AMOUNT:-100}"
XFER_CHANGE=$(( ${SUPPLY:-1000000} - XFER_TO_BOB ))
log "  allocating $XFER_TO_BOB to bob, $XFER_CHANGE back to alice"

build_sign_send xfer "$BOB" "${SEND_NICKS:-1000}" "$RUN/xfer.env" \
  --names "$TOKEN_NOTE" \
  "$BOB_LOCK=transfer:$TOKEN:$XFER_TO_BOB" \
  "$ALICE_LOCK=transfer:$TOKEN:$XFER_CHANGE"
. "$RUN/xfer.env"
XFER_TXID="$TXID"; XFER_HEIGHT="$HEIGHT"
echo "TRANSFER txid=$XFER_TXID height=$XFER_HEIGHT"

log "== stage 7: replay the mined transactions and assert balances =="
"$NMEME_INDEX" rebuild --addr "${PUBLIC_ADDR:-127.0.0.1:5556}" --token "$TOKEN" \
  --step "$GENESIS_TXID:$RUN/genesis/final.jam" \
  --step "$XFER_TXID:$RUN/xfer/final.jam" \
  --address "$ALICE" --address "$BOB" \
  --expect "$ALICE_LOCK=$XFER_CHANGE" \
  --expect "$BOB_LOCK=$XFER_TO_BOB" \
  --expect-total "${SUPPLY:-1000000}" \
  > "$RUN/balances.txt" || die "balance rebuild or assertions failed"
cat "$RUN/balances.txt"

echo
echo "== summary =="
echo "genesis  txid=$GENESIS_TXID height=$GENESIS_HEIGHT"
echo "transfer txid=$XFER_TXID height=$XFER_HEIGHT"
echo "token    $TOKEN"
