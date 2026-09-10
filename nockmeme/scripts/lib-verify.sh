# Decision logic for `nockchain-wallet verify-hash`, factored out so it can be
# tested without a wallet, a node, or a signature.
#
# The wallet reports the result through its exit code and prints one of two
# fixed strings (hoon/apps/wallet/wallet.hoon:2028-2030):
#
#   # Valid signature, hash verified         [%exit 0]
#   # Invalid signature, hash not verified    [%exit 1]
#
# The trap: "Invalid signature" CONTAINS the substring "valid". A gate written
# as `grep -i valid` therefore accepts failure as success and can never fail.
# scripts/gate-selftest.sh pins that.

# verify_decision <exit-code> <output-text>
# Returns 0 only for a genuine, unambiguous success.
verify_decision() {
  local rc="$1" out="$2"

  # The exit code is authoritative.
  [ "$rc" = "0" ] || return 1

  # Belt and braces: an exit code of 0 with failure text means something
  # unexpected happened, and unexpected is not success.
  printf '%s' "$out" | grep -qF 'Invalid signature' && return 1
  printf '%s' "$out" | grep -qF 'Valid signature, hash verified' || return 1

  return 0
}
