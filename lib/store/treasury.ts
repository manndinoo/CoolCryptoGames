import { PublicKey } from '@solana/web3.js'

/**
 * The wallet that receives payments.
 *
 * Purchases are off unless this is set to a valid address AND the payments flag
 * is on. Two independent conditions, so neither a stray flag nor a stray
 * address is enough on its own to start charging anyone.
 *
 * Nothing about this address is secret — it is the public recipient of a public
 * transfer, and it is shown to the player before they sign.
 */
/**
 * The platform treasury, supplied by the product owner.
 *
 * Committed rather than left to a dashboard because every setup step is a step
 * that gets skipped or mistyped, and a mistyped recipient sends real money to a
 * stranger. It is public by nature — the recipient of a public transfer, shown
 * to the player before they sign — so there is nothing here to keep secret.
 *
 * An environment variable still wins, so a fork, a staging deploy or a devnet
 * run can point somewhere else without editing code.
 */
const DEFAULT_TREASURY = 'EwyzBV1hAVYWvtP6dUiFkXVvwaB9WQ2ghMxP1TjgAkQy'

export function treasuryAddress(): string | null {
  const raw =
    process.env.CCG_TREASURY_ADDRESS ??
    process.env.NEXT_PUBLIC_CCG_TREASURY_ADDRESS ??
    DEFAULT_TREASURY
  // Validated even though it is a constant. A committed address is still a
  // typed address, and the one failure that cannot be undone is paying into
  // something no key can spend from.
  return isValidAddress(raw) ? raw : null
}

/**
 * A base58 address that is also a point on the ed25519 curve.
 *
 * The curve check matters for a treasury: an off-curve address is a program
 * derived address, which no private key can sign for. Sending to one that was
 * not created to receive funds is how money becomes permanently unspendable,
 * and a typo can produce one.
 */
export function isValidAddress(value: string): boolean {
  try {
    const key = new PublicKey(value)
    return PublicKey.isOnCurve(key.toBytes())
  } catch {
    return false
  }
}
