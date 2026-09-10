#!/usr/bin/env bash
# Live NMEME demonstration on a local fakenet chain.
#
# Stages, in order, because each depends on the last:
#   1  two fresh wallets, isolated by NOCKAPP_HOME
#   2  mine to Alice until she has a spendable note
#   3  build an ordinary transaction with the wallet
#   4  GATE: verify the Rust sig-hash against the wallet's own signature
#   5  attach a token claim, re-sign, broadcast
#   6  rebuild balances from the chain
#
# Stage 4 is a gate, not a formality. If the Rust digest disagrees with the
# wallet's, everything after it produces signatures a node rejects for reasons
# that read like fee or networking faults. Nothing proceeds past a failed gate.
#
# Every wallet call pins --client private to the LOCAL node: the CLI's default
# endpoint is a public node.
set -uo pipefail

REPO="${REPO:?set REPO to the nockchain checkout}"
RUN="${RUN:?set RUN to a working directory}"
PORT="${PORT:-25655}"
WALLET="$REPO/target/release/nockchain-wallet"
NMEME_TX="$REPO/target/debug/nmeme-tx"
MINER="$REPO/target/release/zk-pow-mine"
W="$RUN/wallets"

wallet() { # wallet <name> <args...>
  local who="$1"; shift
  ( cd "$W/$who" && NOCKAPP_HOME="$W/$who" RUST_LOG=error "$WALLET" \
      --client private --private-grpc-server-port "$PORT" --fakenet "$@" )
}
strip() { sed 's/\x1b\[[0-9;]*m//g'; }

echo "== stage 1: wallets =="
mkdir -p "$W/alice" "$W/bob"
for who in alice bob; do
  [ -f "$W/$who/.done" ] || { wallet "$who" keygen >/dev/null 2>&1; touch "$W/$who/.done"; }
done
ALICE=$(wallet alice list-active-addresses 2>&1 | strip | grep -oE '^- Address: .*' | head -1 | sed 's/^- Address: //')
BOB=$(wallet bob list-active-addresses 2>&1 | strip | grep -oE '^- Address: .*' | head -1 | sed 's/^- Address: //')
echo "alice=$ALICE"
echo "bob=$BOB"
[ -n "$ALICE" ] && [ -n "$BOB" ] || { echo "FAIL: could not read wallet addresses"; exit 1; }

echo "== stage 2: mine to alice =="
"$MINER" --node-addr "http://127.0.0.1:$PORT" --mining-pkh "$ALICE" --num-threads 1 \
  >"$RUN/miner.log" 2>&1 &
echo "miner pid=$!"
# fakenet sets coinbase-timelock-min=1, so a couple of blocks is enough.
DEADLINE=$((SECONDS + ${MINE_TIMEOUT:-1200}))
while (( SECONDS < DEADLINE )); do
  HEIGHT=$(grep -ao "added to validated blocks at [0-9]*" "$RUN/node.log" 2>/dev/null | tail -1 | grep -oE '[0-9]+$')
  [ -n "${HEIGHT:-}" ] && [ "$HEIGHT" -ge "${MIN_HEIGHT:-3}" ] && break
  sleep 10
done
echo "height=${HEIGHT:-none}"
[ -n "${HEIGHT:-}" ] || { echo "FAIL: no block mined"; exit 1; }

echo "== stage 3: build an ordinary transaction =="
wallet alice list-notes 2>&1 | strip | tee "$RUN/alice-notes.txt" | head -30
NAME=$(grep -oE '\[[A-Za-z0-9]+ [A-Za-z0-9]+\]' "$RUN/alice-notes.txt" | head -1)
echo "note=$NAME"
[ -n "$NAME" ] || { echo "FAIL: alice has no notes"; exit 1; }
# Pay Bob, not Alice: a self-payment would put both seeds on one lock-root,
# where consensus merges them into a single note (FINDINGS section 3). Paying
# Bob leaves a distinct Alice change seed to carry the genesis claim.
wallet alice create-tx --names "$NAME" \
  --recipient "{\"kind\":\"p2pkh\",\"address\":\"$BOB\",\"amount\":${SEND_NICKS:-1000}}" \
  --fee "${FEE_NICKS:-256}" --allow-low-fee 2>&1 | strip | tee "$RUN/create-tx.txt" | tail -5
TX=$(find "$W/alice" -name '*.tx' -o -name '*.jam' | grep -i tx | head -1)
echo "tx=$TX"
[ -n "$TX" ] || { echo "FAIL: no transaction file produced"; exit 1; }

echo "== stage 4: GATE — verify the Rust sig-hash =="
bash "$(dirname "${BASH_SOURCE[0]}")/gate-selftest.sh" || {
  echo "FAIL: the gate's own decision logic is broken; refusing to continue"
  exit 1
}
#
# The wallet reports verification through its EXIT CODE, and prints
#   "# Valid signature, hash verified"      with [%exit 0]
#   "# Invalid signature, hash not verified" with [%exit 1]
# (hoon/apps/wallet/wallet.hoon:2028-2030).
#
# An earlier version of this gate matched with `grep -i valid`, which matches
# "Invalid" — it would have reported a forged or mismatched digest as PASS.
# The gate now requires the exit status to be 0, requires the exact success
# string, and explicitly rejects the failure string.
# The decision logic lives in lib-verify.sh so it can be tested without a
# wallet or a node; scripts/gate-selftest.sh exercises it against the wallet's
# real output strings, including the "Invalid" contains "valid" trap.
. "$(dirname "${BASH_SOURCE[0]}")/lib-verify.sh"

verify_sig() { # verify_sig <digest> <sigfile> <pubkey> ; 0 iff genuinely valid
  local out rc
  out=$(wallet alice verify-hash "$1" "$2" "$3" 2>&1); rc=$?
  out=$(printf '%s' "$out" | strip)
  printf '%s\n' "$out" >> "$RUN/verify.log"
  verify_decision "$rc" "$out"
}
: > "$RUN/verify.log"
"$NMEME_TX" sighash "$TX" "$RUN" | tee "$RUN/sighash.txt"

# --- negative control -------------------------------------------------------
# Before trusting a PASS, prove the checker can produce a FAIL. A corrupted
# signature must be rejected; if it is accepted, the gate is broken and every
# later PASS is meaningless.
CONTROL_OK=0
while IFS=$'\t' read -r tag name digest pubkey pkh sigfile; do
  [ "$tag" = "SIGHASH" ] || continue
  python3 - "$sigfile" "$sigfile.bad" <<'PYEOF'
import sys
data = bytearray(open(sys.argv[1], 'rb').read())
data[len(data) // 2] ^= 0xFF          # flip one byte in the middle
open(sys.argv[2], 'wb').write(bytes(data))
PYEOF
  if verify_sig "$digest" "$sigfile.bad" "$pubkey"; then
    echo "  CONTROL FAILED: a corrupted signature verified as valid."
    echo "  The gate cannot distinguish valid from invalid; refusing to continue."
    exit 1
  fi
  echo "  control ok: corrupted signature correctly rejected ($name)"
  CONTROL_OK=1
  break
done < "$RUN/sighash.txt"
[ "$CONTROL_OK" -eq 1 ] || { echo "FAIL: no signature to run the control against"; exit 1; }

# --- the gate itself --------------------------------------------------------
PASS=0; TOTAL=0
while IFS=$'\t' read -r tag name digest pubkey pkh sigfile; do
  [ "$tag" = "SIGHASH" ] || continue
  TOTAL=$((TOTAL+1))
  if verify_sig "$digest" "$sigfile" "$pubkey"; then
    echo "  PASS $name  digest=$digest"; PASS=$((PASS+1))
  else
    echo "  FAIL $name — the Rust digest is not what the wallet signed"
  fi
done < "$RUN/sighash.txt"
echo "gate: $PASS/$TOTAL signatures verified"
[ "$TOTAL" -gt 0 ] && [ "$PASS" -eq "$TOTAL" ] || {
  echo "GATE FAILED — stopping. Attaching claims to a transaction whose digest"
  echo "is unverified would make any later node rejection unattributable."
  exit 1
}
echo "GATE PASSED"

echo "== stage 5: attach a claim, re-sign, broadcast =="
"$NMEME_TX" seeds "$TX" | tee "$RUN/seeds.txt"
if grep -q '^MERGED' "$RUN/seeds.txt"; then
  echo "FAIL: two seeds share a lock-root; they merge into one note and only"
  echo "one may carry the claim. Rebuild the transaction with distinct payees."
  exit 1
fi
# The change seed is the larger gift: Alice keeps the remainder of her note.
ALICE_LOCK=$(awk -F'\t' '$1=="SEED"{print $4"\t"$3}' "$RUN/seeds.txt" | sort -rn | head -1 | cut -f2)
echo "alice lock-root=$ALICE_LOCK"
[ -n "$ALICE_LOCK" ] || { echo "FAIL: could not resolve a lock-root"; exit 1; }
# Genesis: token identity is derived from the transaction's input note names,
# so it is fixed before signing and cannot be circular (SPEC section 4).
"$NMEME_TX" attach "$TX" "$ALICE_LOCK" "genesis:${TICKER:-DOGE}:6:${SUPPLY:-1000000}" \
  "$RUN/attached.jam" | tee "$RUN/attach.txt"
NEWHASH=$(awk -F'\t' '$1=="NEWSIGHASH"{print $3}' "$RUN/attach.txt" | head -1)
SPENDNAME=$(awk -F'\t' '$1=="NEWSIGHASH"{print $2}' "$RUN/attach.txt" | head -1)
echo "new sig-hash=$NEWHASH"
[ -n "$NEWHASH" ] || { echo "FAIL: attach produced no digest"; exit 1; }

wallet alice sign-hash "$NEWHASH" 2>&1 | strip | tee "$RUN/sign.txt" | tail -3
NEWSIG=$(find "$W/alice" "$RUN" -name '*.jam' -newer "$RUN/attached.jam" 2>/dev/null | head -1)
echo "signature=$NEWSIG"
[ -n "$NEWSIG" ] || { echo "FAIL: sign-hash produced no signature file"; exit 1; }

PUBKEY=$(awk -F'\t' '$1=="SIGHASH"{print $4}' "$RUN/sighash.txt" | head -1)
PKH=$(awk -F'\t' '$1=="SIGHASH"{print $5}' "$RUN/sighash.txt" | head -1)
"$NMEME_TX" set-sig "$RUN/attached.jam" "$SPENDNAME" "$PKH" "$PUBKEY" "$NEWSIG" \
  "$RUN/final.jam" | tee -a "$RUN/attach.txt"

# Re-verify the finished transaction against its own new digest before sending.
"$NMEME_TX" sighash "$RUN/final.jam" "$RUN/final" > "$RUN/final-sighash.txt" 2>&1 || true
mkdir -p "$RUN/final"
while IFS=$'\t' read -r tag name digest pubkey pkh sigfile; do
  [ "$tag" = "SIGHASH" ] || continue
  if verify_sig "$digest" "$sigfile" "$pubkey"; then
    echo "  re-signed transaction verifies: $name"
  else
    echo "FAIL: re-signed transaction does not verify; not broadcasting"; exit 1
  fi
done < "$RUN/final-sighash.txt"

wallet alice send-tx "$RUN/final.jam" 2>&1 | strip | tee "$RUN/send.txt" | tail -5
TXID=$(grep -oE '[0-9A-Za-z]{40,}' "$RUN/send.txt" | head -1)
echo "txid=$TXID"

echo "== stage 6: wait for inclusion, then rebuild balances =="
DEADLINE=$((SECONDS + ${INCLUDE_TIMEOUT:-900}))
while (( SECONDS < DEADLINE )); do
  wallet alice tx-status "$TXID" 2>&1 | strip | tee "$RUN/tx-status.txt" | tail -3
  grep -qi "confirmed" "$RUN/tx-status.txt" && break
  sleep 15
done
grep -qi "confirmed" "$RUN/tx-status.txt" || { echo "FAIL: transaction not confirmed"; exit 1; }
echo "CONFIRMED $TXID"
wallet alice list-notes 2>&1 | strip > "$RUN/alice-notes-final.txt"
wallet bob   list-notes 2>&1 | strip > "$RUN/bob-notes-final.txt"
echo "final notes written to $RUN/{alice,bob}-notes-final.txt"
