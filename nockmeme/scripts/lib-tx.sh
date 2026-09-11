#!/usr/bin/env bash
# Shared helpers for the live suites (swap-demo.sh carries its own copies;
# it is kept as it ran). Expects: REPO RUN PORT W WALLET NMEME_TX NMEME_INDEX
# MINER PUB S (the suite's output dir) and MINER_PID once the miner runs.
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
sign_hash() { # sign_hash <who> <digest> <dest.jam>
  local who="$1" digest="$2" dest="$3" src="$W/$1/hash.sig"
  rm -f "$src"
  wallet "$who" sign-hash "$digest" >"$RUN/sign-$who.log" 2>&1 || die "sign-hash failed for $who"
  [ -s "$src" ] || die "sign-hash wrote nothing for $who"
  mv "$src" "$dest"
}
list_tx_files() {
  { find "$W/$1/txs" -type f -name '*.tx' 2>/dev/null || true
    find "$W/$1/wallet/txs" -type f -name '*.tx' 2>/dev/null || true; } | sort -u
}
verify_sig() { # <who> <digest> <sigfile> <pubkey>
  local out rc; set +e; out=$(wallet "$1" verify-hash "$2" "$3" "$4" 2>&1); rc=$?; set -e
  out=$(printf '%s' "$out" | strip); printf '%s\n' "$out" >> "$RUN/verify.log"
  verify_decision "$rc" "$out"
}
verify_all() { # <who> <sighash-file> <label>
  local who="$1" file="$2" label="$3" pass=0 total=0
  while IFS=$'\t' read -r tag name digest pubkey pkh sigfile; do
    [ "$tag" = "SIGHASH" ] || continue
    total=$((total+1))
    if verify_sig "$who" "$digest" "$sigfile" "$pubkey"; then pass=$((pass+1)); else echo "  FAIL $label $name" >&2; fi
  done < "$file"
  echo "  $label: $pass/$total verified" >&2
  [ "$total" -gt 0 ] && [ "$pass" -eq "$total" ] || die "$label: signature verification failed"
}
# create_tx <who> <dir> <names-or-empty> <recipient-addr> <amount> -> prints the file
create_tx() {
  local who="$1" dir="$2" names="$3" to="$4" amount="$5"; mkdir -p "$dir"
  list_tx_files "$who" > "$dir/before.txt"
  local args=(create-tx)
  [ -n "$names" ] && args+=(--names "$names")
  args+=(--recipient "{\"kind\":\"p2pkh\",\"address\":\"$to\",\"amount\":$amount}" --fee-nicks "${FEE_NICKS:-8192}" --allow-low-fee)
  wallet "$who" "${args[@]}" >"$dir/create.txt" 2>&1 || die "create-tx failed for $who (see $dir/create.txt)"
  local saved; saved=$(strip < "$dir/create.txt" | grep -oE 'txs/[0-9A-Za-z]+\.tx' | head -1 || true)
  if [ -n "$saved" ] && [ -s "$W/$who/$saved" ]; then echo "$W/$who/$saved"; return 0; fi
  list_tx_files "$who" > "$dir/after.txt"
  comm -13 "$dir/before.txt" "$dir/after.txt" > "$dir/new.txt"
  [ "$(wc -l < "$dir/new.txt")" -eq 1 ] || die "$who: expected exactly one new transaction file (see $dir/create.txt)"
  head -1 "$dir/new.txt"
}
node_height() { wait_for_height "$RUN/node.log" 0 10; }
confirm() { # <txid> <label> -> HEIGHT in $S/<label>.env
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
send() { # <file> <label> -> txid
  "$NMEME_INDEX" send --addr "$PUB" --tx "$1" >"$S/send-$2.txt" 2>&1 || true
  awk -F'\t' '$1=="TXID"{print $2}' "$S/send-$2.txt" | head -1
}
quiet() { # run a node read with the miner paused
  kill -STOP "$MINER_PID" 2>/dev/null || true
  local rc=0; "$@" || rc=$?
  kill -CONT "$MINER_PID" 2>/dev/null || true
  return $rc
}
unspent() { # <first> <last>
  local i out
  for i in 1 2 3 4; do
    if out=$(quiet "$NMEME_INDEX" funding --addr "$PUB" --first "$1" 2>/dev/null); then
      grep -qF "$2" <<<"$out" && return 0 || return 1
    fi
    sleep 5
  done
  die "could not read the unspent set at $1"
}
# expect_rejected <file> <label> <input "first last">...: the engine must refuse it
expect_rejected() {
  local file="$1" label="$2"; shift 2
  local txid; txid=$("$NMEME_INDEX" tx-id --tx "$file")
  log "== attack: $label (txid $txid) =="
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
  if [ -z "$engine" ] && grep -q "MEMPOOL	not admitted" "$S/send-$label.txt"; then engine="tx-acc: process failed: (refused at admission)"; fi
  [ -n "$engine" ] || die "$label: the node log shows no transaction-engine verdict for $txid; inconclusive"
  echo "REJECTED	$label	txid=$txid	engine: ${engine#tx-acc: process failed: }	not mined in 2 blocks	inputs still unspent"
  echo "  mempool: $(awk -F'\t' '$1=="MEMPOOL"{print $2}' "$S/send-$label.txt")"
}
# resign <who> <orig-sighash.txt> <assembled.jam> <newsighash-source.txt> <out.jam>
# Every spend the wallet signed in the original transaction is re-signed
# over its new digest (the NEWSIGHASH line for that spend's name).
resign() {
  local who="$1" orig="$2" jam="$3" src="$4" out="$5" cur="$jam" i=0
  local name digest pubkey pkh sigfile tag newd
  while IFS=$'\t' read -r tag name digest pubkey pkh sigfile; do
    [ "$tag" = "SIGHASH" ] || continue
    newd=$(awk -F'\t' -v n="$name" '$1=="NEWSIGHASH" && $2==n {print $3}' "$src" | head -1)
    [ -n "$newd" ] || die "resign: no NEWSIGHASH for spend $name in $src"
    i=$((i+1))
    sign_hash "$who" "$newd" "$out.$i.sig"
    "$NMEME_TX" set-sig "$cur" "$name" "$pkh" "$pubkey" "$out.$i.sig" "$out.$i.jam" >/dev/null || die "resign: set-sig $name"
    cur="$out.$i.jam"
  done < "$orig"
  [ "$i" -gt 0 ] || die "resign: nothing to sign"
  cp "$cur" "$out"
}
