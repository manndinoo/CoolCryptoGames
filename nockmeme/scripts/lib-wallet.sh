#!/usr/bin/env bash
# The wallet-backend rules (review of pack 5, point 4) as this tooling
# applies them, for a wallet the suites drive. Expects lib-tx.sh's helpers
# and: NMEME_INDEX PUB W.
#
#   - NOCK for a payment and for the network fee comes from plain notes
#     only: a note carrying a token claim is never selected as funds (a
#     token-unaware spend of it burns the tokens, SPEC §7)
#   - a spend of a token note always carries its change claim (the callers
#     attach `<change-lock>=transfer:<token>:<held - sent>`)
#   - the inputs of a transaction that was sent are reserved until it is
#     mined (its inputs left the unspent set) or refused (the node's
#     answer), so a second transaction never double-selects them
#   - the fee a transaction carries is checked against what the chain
#     requires before it is sent (nmeme-tx's FEE line: current >= required)
#
# The ledger is $W/<who>/pending.tsv: <txid> <first> <last> <label> <height>.

w_ledger() { echo "$W/$1/pending.tsv"; }
# w_reserve <who> <txid> <label> <height> <"first last">...
w_reserve() {
  local who="$1" txid="$2" label="$3" height="$4"; shift 4
  local n; for n in "$@"; do printf '%s\t%s\t%s\t%s\t%s\n' "$txid" "${n%% *}" "${n##* }" "$label" "$height" >> "$(w_ledger "$who")"; done
}
w_release() { # <who> <txid>
  local f; f=$(w_ledger "$1"); [ -f "$f" ] || return 0
  grep -v "^$2	" "$f" > "$f.tmp" || true; mv "$f.tmp" "$f"
}
w_reserved() { # <who> -> "first last" per reserved note
  local f; f=$(w_ledger "$1"); [ -f "$f" ] && awk -F'\t' '{print $2" "$3}' "$f" || true
}
w_pending() { # <who> -> the ledger's lines (txid label height notes)
  local f; f=$(w_ledger "$1"); [ -f "$f" ] && awk -F'\t' '{k=$1"\t"$4"\t"$5; n[k]=n[k]" ["$2" "$3"]"} END{for (k in n) print "PENDING\t"k"\tinputs:"n[k]}' "$f" || true
}
# w_reconcile <who>: a pending transaction whose inputs have all left the
# unspent set was mined; its reservation is released. One whose inputs are
# all still unspent is still pending (or was refused: the caller releases
# it on the node's answer).
w_reconcile() {
  local who="$1" f; f=$(w_ledger "$who"); [ -f "$f" ] || return 0
  local txid
  for txid in $(awk -F'\t' '{print $1}' "$f" | sort -u); do
    local still=0 n
    while read -r n; do unspent "${n%% *}" "${n##* }" && still=1; done < <(awk -F'\t' -v t="$txid" '$1==t{print $2" "$3}' "$f")
    if [ "$still" = 0 ]; then echo "MINED-RELEASED	$txid"; w_release "$who" "$txid"; else echo "STILL-PENDING	$txid"; fi
  done
}
# w_pick_plain <who> <lock> <need-nicks> -> "first last amount": a plain
# unspent note at the lock, not reserved, holding at least <need>
w_pick_plain() {
  local who="$1" lock="$2" need="$3" out="$W/$who/funding-now.txt"
  quiet "$NMEME_INDEX" funding --addr "$PUB" --lock "$lock" > "$out" 2>/dev/null || die "funding read at $lock"
  local reserved; reserved=$(w_reserved "$who")
  local n
  while read -r n; do
    grep -qF "${n% *}" <<<"$reserved" && continue
    echo "$n"; return 0
  done < <(awk -F'\t' -v need="$need" '$1=="FUNDING" && $4=="plain" && $5+0>=need {print $2" "$3" "$5}' "$out" | sort -k3,3n)
  return 1
}
# w_nock <lock> -> nicks in plain notes at the lock (spendable as funds), and the count of token notes
w_nock() {
  quiet "$NMEME_INDEX" funding --addr "$PUB" --lock "$1" 2>/dev/null | awk -F'\t' '$1=="FUNDING"{ if ($4=="plain"||$4=="coinbase") s+=$5; else t++ } END{print s+0" plain-nicks, "t+0" token-notes"}'
}
# w_fee_ok <attach-or-trade output file>: the FEE line says current >= required
w_fee_ok() {
  local cur req; cur=$(grep -oE 'current=[0-9]+' "$1" | head -1 | cut -d= -f2); req=$(grep -oE 'required=[0-9]+' "$1" | head -1 | cut -d= -f2)
  [ -n "$cur" ] && [ -n "$req" ] && [ "$cur" -ge "$req" ]
}
