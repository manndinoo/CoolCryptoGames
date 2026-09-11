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
. "$HERE/lib-mine.sh"

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

# The wait is a tested function (lib-mine.sh); its self-test runs first.
bash "$HERE/height-gate-selftest.sh" >&2 || die "the height gate's own logic is broken"
HEIGHT=$(wait_for_height "$RUN/node.log" "${MIN_HEIGHT:-3}" "${MINE_TIMEOUT:-1800}") \
  || die "mining did not reach height ${MIN_HEIGHT:-3} within ${MINE_TIMEOUT:-1800}s"
log "height=$HEIGHT"

# Chain height is not enough. Against a node that already has blocks (a second
# run on the same chain) the height gate passes before a single block has paid
# THIS wallet, and create-tx then fails with "insufficient funds:
# selected_total=0" (seen live). So also wait until Alice owns a note, then for
# two more blocks so the fakenet coinbase timelock (1 block) has passed.
wait_for_note() {
  local who="$1" deadline=$((SECONDS + $2)) out
  while (( SECONDS < deadline )); do
    out=$(wallet "$who" list-notes 2>/dev/null | strip)
    if grep -aq "Wallet Notes" <<<"$out" && ! grep -aq "No notes found" <<<"$out"; then return 0; fi
    sleep 10
  done
  return 1
}
wait_for_note alice "${MINE_TIMEOUT:-1800}" || die "no mined block paid alice within ${MINE_TIMEOUT:-1800}s"
NOTE_HEIGHT=$(wait_for_height "$RUN/node.log" 0 10)
HEIGHT=$(wait_for_height "$RUN/node.log" $((NOTE_HEIGHT + 2)) "${MINE_TIMEOUT:-1800}") \
  || die "coinbase did not mature (height $((NOTE_HEIGHT + 2)) not reached)"
log "alice has a note at height<=$NOTE_HEIGHT; chain at $HEIGHT, coinbase mature"

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
  local names="" funding="" token_note=""
  while :; do
    case "${1:-}" in
      --names) names="$2"; shift 2 ;;
      --funding) funding="$2"; shift 2 ;;
      --token-note) token_note="$2"; shift 2 ;;
      *) break ;;
    esac
  done
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

  # The input gate. The wallet chose the inputs (even with --names it may add
  # more); every one must be a note the chain showed carrying no claim, or the
  # single token note this transaction means to move. Otherwise a token note
  # is about to be spent as ordinary funds, which burns it (SPEC §7) — refuse.
  if [ -n "$funding" ]; then
    if [ -n "$token_note" ]; then
      "$NMEME_INDEX" check-inputs --tx "$tx" --funding "$funding" --token-note "$token_note" \
        >"$dir/check-inputs.txt" 2>&1 || die "$label: input gate refused (see $dir/check-inputs.txt)"
    else
      "$NMEME_INDEX" check-inputs --tx "$tx" --funding "$funding" \
        >"$dir/check-inputs.txt" 2>&1 || die "$label: input gate refused (see $dir/check-inputs.txt)"
    fi
    sed 's/^/  /' "$dir/check-inputs.txt" >&2
  fi

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

log "== stage 5: resolve lock-roots =="
# A throwaway create-tx (never broadcast) tells us the two lock-roots.
"$NMEME_TX" seeds /dev/null >/dev/null 2>&1 || true
mkdir -p "$RUN/probe"
list_tx_files alice > "$RUN/probe/before.txt"
wallet alice create-tx \
  --recipient "{\"kind\":\"p2pkh\",\"address\":\"$BOB\",\"amount\":${SEND_NICKS:-1000}}" \
  --fee-nicks "${FEE_NICKS:-4096}" --allow-low-fee >"$RUN/probe/create.txt" 2>&1 \
  || die "probe create-tx failed"
list_tx_files alice > "$RUN/probe/after.txt"
comm -13 "$RUN/probe/before.txt" "$RUN/probe/after.txt" > "$RUN/probe/new.txt"
PROBE=$(head -1 "$RUN/probe/new.txt")
[ -s "$PROBE" ] || die "probe produced no transaction"
"$NMEME_TX" seeds "$PROBE" > "$RUN/probe/seeds.txt" || die "probe seeds failed"
ALICE_LOCK=$(awk -F'\t' '$1=="SEED"{print $4"\t"$3}' "$RUN/probe/seeds.txt" | sort -rn | head -1 | cut -f2)
BOB_LOCK=$(awk -F'\t' '$1=="SEED"{print $4"\t"$3}' "$RUN/probe/seeds.txt" | sort -n | head -1 | cut -f2)
[ -n "$ALICE_LOCK" ] && [ -n "$BOB_LOCK" ] || die "could not resolve lock-roots"
[ "$ALICE_LOCK" != "$BOB_LOCK" ] || die "alice and bob resolved to the same lock-root"
log "alice lock-root=$ALICE_LOCK"
log "bob   lock-root=$BOB_LOCK"
# Coinbase notes do NOT sit at Alice's change lock-root: a miner is paid at a
# lock built from its mining pkh (seen live: 501 rewards at one first-name,
# the change chain at another). The wallet lists every note it owns by full
# name, so funding is read at every distinct first-name it reports.
ALICE_FIRSTS=$(wallet alice list-notes 2>/dev/null | strip | grep -a -A1 "^- Name:" \
  | grep -aoE "[1-9A-HJ-NP-Za-km-z]{40,60}" | awk 'NR%2==1' | sort -u)
[ -n "$ALICE_FIRSTS" ] || die "alice's wallet lists no notes"
FUND_ARGS="--lock $ALICE_LOCK"
for f in $ALICE_FIRSTS; do FUND_ARGS="$FUND_ARGS --first $f"; done
log "funding is read at: $FUND_ARGS"
rm -f "$PROBE"

PUB="${PUBLIC_ADDR:-127.0.0.1:5556}"

# token_cycle <tag> <ticker>: create a token, then transfer some of it.
#
# Every input is chosen by name and checked against the chain BEFORE
# broadcast. A genesis may spend only notes the chain shows carrying no claim
# (`nmeme-index funding` -> tokenfree); a transfer may spend only such notes
# plus the one token note it moves, named by the full identity computed from
# the genesis file (`nmeme-index outputs`). A stock wallet left to choose its
# own inputs spends token notes as ordinary funds and burns them — seen live,
# twice, on this chain.
token_cycle() {
  local tag="$1" ticker="$2"
  local g="$RUN/genesis-$tag" x="$RUN/xfer-$tag"
  mkdir -p "$g" "$x"

  log "== $tag: genesis ($ticker) =="
  # Alice may own nothing but token notes at this point (after a cycle, her
  # change IS the token note). Wait for the miner to pay her a fresh coinbase,
  # then two more blocks for the fakenet coinbase timelock. The funding file
  # that is kept is the last read, taken once the note is spendable.
  local need=$(( ${SEND_NICKS:-1000} + ${FEE_NICKS:-4096} ))
  local fund="" deadline=$((SECONDS + ${MINE_TIMEOUT:-1800}))
  while (( SECONDS < deadline )); do
    # shellcheck disable=SC2086
    "$NMEME_INDEX" funding --addr "$PUB" $FUND_ARGS > "$g/funding.txt" \
      || die "$tag: funding read failed"
    fund=$(awk -F'\t' -v need="$need" '$1=="FUNDING" && $4=="tokenfree" && $5+0>=need {print "["$2" "$3"]"; exit}' "$g/funding.txt")
    [ -n "$fund" ] && break
    sleep 15
  done
  [ -n "$fund" ] || die "$tag: no token-free note worth >= $need nicks reached alice within ${MINE_TIMEOUT:-1800}s (see $g/funding.txt)"
  local h; h=$(awk -F'\t' '$1=="HEIGHT"{print $2}' "$g/funding.txt")
  wait_for_height "$RUN/node.log" $((h + 2)) "${MINE_TIMEOUT:-1800}" >/dev/null \
    || die "$tag: coinbase did not mature"
  # shellcheck disable=SC2086
  "$NMEME_INDEX" funding --addr "$PUB" $FUND_ARGS > "$g/funding.txt" \
    || die "$tag: funding read failed"
  grep -q "$(echo "$fund" | tr -d '[]' | cut -d' ' -f2)" "$g/funding.txt" || die "$tag: funding note vanished"
  log "  token-free funding note: $fund"

  build_sign_send "genesis-$tag" "$BOB" "${SEND_NICKS:-1000}" "$g.env" \
    --names "$fund" --funding "$g/funding.txt" \
    "$ALICE_LOCK=genesis:$ticker:6:${SUPPLY:-1000000}"
  . "$g.env"
  local gtxid="$TXID" gheight="$HEIGHT"
  echo "GENESIS[$tag] txid=$gtxid height=$gheight"
  local token
  token=$("$NMEME_INDEX" token-id --tx "$g/final.jam" --ticker "$ticker" --decimals 6) \
    || die "$tag: could not derive token id"
  echo "TOKEN[$tag] $token"

  log "== $tag: transfer ${XFER_AMOUNT:-100} to bob, rest back to alice =="
  local gnote
  gnote=$("$NMEME_INDEX" outputs --tx "$g/final.jam" \
    | awk -F'\t' -v l="$ALICE_LOCK" '$1=="OUTPUT" && $2==l {print "["$3" "$4"]"; exit}')
  [ -n "$gnote" ] || die "$tag: no genesis output at alice's lock"
  # shellcheck disable=SC2086
  "$NMEME_INDEX" funding --addr "$PUB" $FUND_ARGS > "$x/funding.txt" \
    || die "$tag: funding read failed"
  "$NMEME_INDEX" token-note --addr "$PUB" --lock "$ALICE_LOCK" --name "$gnote" > "$x/token-note.txt" \
    || die "$tag: the genesis output $gnote is not an unspent token note on chain"
  sed 's/^/  /' "$x/token-note.txt" >&2
  local to=${XFER_AMOUNT:-100} change=$(( ${SUPPLY:-1000000} - ${XFER_AMOUNT:-100} ))
  build_sign_send "xfer-$tag" "$BOB" "${SEND_NICKS:-1000}" "$x.env" \
    --names "$gnote" --funding "$x/funding.txt" --token-note "$gnote" \
    "$BOB_LOCK=transfer:$token:$to" \
    "$ALICE_LOCK=transfer:$token:$change"
  . "$x.env"
  echo "TRANSFER[$tag] txid=$TXID height=$HEIGHT"
  printf -v "TOKEN_$tag" '%s' "$token"
  printf -v "GTX_$tag" '%s' "$gtxid"
  printf -v "XTX_$tag" '%s' "$TXID"
}

token_cycle A "${TICKER:-DOGE}"
token_cycle B "${TICKER2:-PEPE}"

log "== stage 9: replay the complete history and assert both tokens =="
STEPS="--step $GTX_A:$RUN/genesis-A/final.jam --step $XTX_A:$RUN/xfer-A/final.jam \
       --step $GTX_B:$RUN/genesis-B/final.jam --step $XTX_B:$RUN/xfer-B/final.jam"
PROOFS="--funding $RUN/genesis-A/funding.txt --funding $RUN/xfer-A/funding.txt \
        --funding $RUN/genesis-B/funding.txt --funding $RUN/xfer-B/funding.txt"
XFER_TO="${XFER_AMOUNT:-100}"; XFER_CHANGE=$(( ${SUPPLY:-1000000} - XFER_TO ))
for tag in A B; do
  tok="TOKEN_$tag"
  # shellcheck disable=SC2086
  "$NMEME_INDEX" rebuild --addr "$PUB" --token "${!tok}" $STEPS $PROOFS \
    --lock "$ALICE_LOCK" --lock "$BOB_LOCK" \
    --expect "$ALICE_LOCK=$XFER_CHANGE" --expect "$BOB_LOCK=$XFER_TO" \
    --expect-total "${SUPPLY:-1000000}" \
    > "$RUN/balances-$tag.txt" || die "token $tag: rebuild over the complete history failed"
  echo "== balances[$tag] over all four transactions =="
  grep -E "^(HEIGHT|BALANCE|TOTAL|SUPPLY|TICKER|ASSERT)" "$RUN/balances-$tag.txt"
done

log "== stage 10: the omitted-history guard, live =="
# Token B's two transactions alone, with no funding proofs: the genesis input's
# token status is unknown to that replay, so the rebuild must refuse. Before
# this guard, the same call reported a creation (RESULTS.md, height 44).
set +e
"$NMEME_INDEX" rebuild --addr "$PUB" --token "$TOKEN_B" \
  --step "$GTX_B:$RUN/genesis-B/final.jam" --step "$XTX_B:$RUN/xfer-B/final.jam" \
  --lock "$ALICE_LOCK" --lock "$BOB_LOCK" > "$RUN/omitted-history.txt" 2>&1
rc=$?
set -e
if [ "$rc" -eq 0 ]; then die "omitted-history replay was NOT refused (see $RUN/omitted-history.txt)"; fi
grep -q "neither an output of an earlier supplied step nor" "$RUN/omitted-history.txt" \
  || die "omitted-history replay failed for the wrong reason (see $RUN/omitted-history.txt)"
echo "OMITTED-HISTORY refused: $(grep -o 'input \[[^]]*\]' "$RUN/omitted-history.txt" | head -1)"

echo
echo "== summary =="
echo "token A  $TOKEN_A  genesis=$GTX_A  transfer=$XTX_A"
echo "token B  $TOKEN_B  genesis=$GTX_B  transfer=$XTX_B"
echo "A's balances are unchanged by B's creation; both rebuilt from the chain with input provenance proven."
