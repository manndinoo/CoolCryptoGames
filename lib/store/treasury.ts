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
export function treasuryAddress(): string | null {
  const raw = process.env.CCG_TREASURY_ADDRESS ?? process.env.NEXT_PUBLIC_CCG_TREASURY_ADDRESS
  if (!raw) return null
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
