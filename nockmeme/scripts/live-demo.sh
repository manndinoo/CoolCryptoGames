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

die() { echo "FAIL: $*" >&2; exit 1; }
strip() { sed 's/\x1b\[[0-9;]*m//g'; }

# Wallet runs with cwd = the wallet dir, because sign-hash writes its output to
# a fixed relative filename (hash.sig, wallet.hoon:1996).
wallet() {
  local who="$1"; shift
  ( cd "$W/$who" && NOCKAPP_HOME="$W/$who" RUST_LOG=error "$WALLET" \
      --client private --private-grpc-server-port "$PORT" --fakenet "$@" )
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

# broadcast_and_confirm <tx.jam> <label> -> echoes "<txid> <height>"
broadcast_and_confirm() {
  local tx="$1" label="$2"
  wallet alice send-tx "$tx" >"$RUN/send-$label.txt" 2>&1 \
    || die "send-tx failed for $label (see $RUN/send-$label.txt)"
  strip < "$RUN/send-$label.txt" | tail -5
  local txid
  txid=$(grep -oE '[0-9A-Za-z]{40,}' "$RUN/send-$label.txt" | head -1 || true)
  [ -n "$txid" ] || die "$label: no transaction id in send-tx output"

  local deadline=$((SECONDS + ${INCLUDE_TIMEOUT:-900}))
  while (( SECONDS < deadline )); do
    set +e
    wallet alice tx-status "$txid" >"$RUN/status-$label.txt" 2>&1
    set -e
    if grep -qi "confirmed" "$RUN/status-$label.txt"; then
      local h
      h=$(grep -oE 'height[^0-9]*([0-9]+)' "$RUN/status-$label.txt" | grep -oE '[0-9]+' | head -1 || true)
      echo "$txid ${h:-unknown}"
      return 0
    fi
    sleep 15
  done
  die "$label: transaction $txid not confirmed within ${INCLUDE_TIMEOUT:-900}s"
}

# build_sign_send <label> <recipient-pkh> <amount> <claim-spec> <lock-selector>
# Builds an ordinary transaction, gates it, attaches a claim, re-signs,
# re-verifies, and broadcasts. Echoes "<txid> <height>".
build_sign_send() {
  local label="$1" to="$2" amount="$3" claim="$4"
  local dir="$RUN/$label"; mkdir -p "$dir"

  local tx
  # The wallet writes ./txs/<name>.tx relative to its cwd (wallet.hoon:1687),
  # but the same file can land under wallet/txs depending on how NOCKAPP_HOME
  # resolves. Rather than guess a path or a timestamp window, snapshot the file
  # set before and after and take the difference: exactly one new file is
  # expected, and anything else is an error rather than a lucky pick.
  list_tx_files alice > "$dir/tx-before.txt"
  wallet alice create-tx \
    --recipient "{\"kind\":\"p2pkh\",\"address\":\"$to\",\"amount\":$amount}" \
    --fee "${FEE_NICKS:-256}" --allow-low-fee >"$dir/create.txt" 2>&1 \
    || die "$label: create-tx failed (see $dir/create.txt)"
  list_tx_files alice > "$dir/tx-after.txt"
  comm -13 "$dir/tx-before.txt" "$dir/tx-after.txt" > "$dir/tx-new.txt"

  local count
  count=$(wc -l < "$dir/tx-new.txt")
  [ "$count" -eq 1 ] || die "$label: expected exactly 1 new transaction file, got $count
$(cat "$dir/tx-new.txt")"
  tx=$(head -1 "$dir/tx-new.txt")
  [ -s "$tx" ] || die "$label: transaction file $tx is missing or empty"
  echo "  tx=$tx"

  "$NMEME_TX" sighash "$tx" "$dir" >"$dir/sighash.txt" \
    || die "$label: sighash failed (unsigned transaction?)"
  verify_all alice "$dir/sighash.txt" "$label-gate"

  # Which seed carries the claim: Alice's change (the larger gift), so the
  # supply stays with her at genesis and the transfer pays Bob explicitly.
  "$NMEME_TX" seeds "$tx" >"$dir/seeds.txt" || die "$label: seeds failed"
  grep -q '^MERGED' "$dir/seeds.txt" && die "$label: two seeds share a lock-root; only one may carry a claim"
  local lock
  lock=$(awk -F'\t' '$1=="SEED"{print $4"\t"$3}' "$dir/seeds.txt" | sort -rn | head -1 | cut -f2)
  [ -n "$lock" ] || die "$label: could not resolve a lock-root"
  echo "  lock-root=$lock"

  "$NMEME_TX" attach "$tx" "$lock" "$claim" "$dir/attached.jam" >"$dir/attach.txt" \
    || die "$label: attach failed"
  local newhash spendname
  newhash=$(awk -F'\t' '$1=="NEWSIGHASH"{print $3}' "$dir/attach.txt" | head -1)
  spendname=$(awk -F'\t' '$1=="NEWSIGHASH"{print $2}' "$dir/attach.txt" | head -1)
  [ -n "$newhash" ] && [ -n "$spendname" ] || die "$label: attach produced no digest"
  echo "  new sig-hash=$newhash"

  sign_hash alice "$newhash" "$dir/new.sig"

  local pubkey pkh
  pubkey=$(awk -F'\t' '$1=="SIGHASH"{print $4}' "$dir/sighash.txt" | head -1)
  pkh=$(awk -F'\t' '$1=="SIGHASH"{print $5}' "$dir/sighash.txt" | head -1)
  "$NMEME_TX" set-sig "$dir/attached.jam" "$spendname" "$pkh" "$pubkey" "$dir/new.sig" \
    "$dir/final.jam" >>"$dir/attach.txt" || die "$label: set-sig failed"

  # Re-verify the finished transaction against its own new digest.
  mkdir -p "$dir/final"
  "$NMEME_TX" sighash "$dir/final.jam" "$dir/final" >"$dir/final-sighash.txt" \
    || die "$label: sighash of the re-signed transaction failed"
  verify_all alice "$dir/final-sighash.txt" "$label-resigned"

  broadcast_and_confirm "$dir/final.jam" "$label"
}

echo "== stage 5: genesis =="
read -r GENESIS_TXID GENESIS_HEIGHT < <(
  build_sign_send genesis "$BOB" "${SEND_NICKS:-1000}" \
    "genesis:${TICKER:-DOGE}:6:${SUPPLY:-1000000}"
)
echo "GENESIS txid=$GENESIS_TXID height=$GENESIS_HEIGHT"

echo "== stage 6: transfer =="
TOKEN=$("$NMEME_INDEX" token-id --tx "$RUN/genesis/final.jam" \
  --ticker "${TICKER:-DOGE}" --decimals 6) || die "could not derive token id"
echo "token=$TOKEN"
read -r XFER_TXID XFER_HEIGHT < <(
  build_sign_send xfer "$BOB" "${SEND_NICKS:-1000}" \
    "transfer:$TOKEN:${XFER_AMOUNT:-100}"
)
echo "TRANSFER txid=$XFER_TXID height=$XFER_HEIGHT"

echo "== stage 7: rebuild balances from the canonical chain =="
# The public gRPC service (off by default) is the only one exposing
# WalletGetBalance, which is where note-data is readable back.
"$NMEME_INDEX" rebuild --addr "${PUBLIC_ADDR:-127.0.0.1:5556}" --token "$TOKEN" \
  --address "$ALICE" --address "$BOB" >"$RUN/balances.txt" \
  || die "balance rebuild failed"
cat "$RUN/balances.txt"

echo
echo "== summary =="
echo "genesis  txid=$GENESIS_TXID height=$GENESIS_HEIGHT"
echo "transfer txid=$XFER_TXID height=$XFER_HEIGHT"
echo "token    $TOKEN"
cat "$RUN/balances.txt"
