import { PublicKey } from '@solana/web3.js'
import bs58 from 'bs58'
import nacl from 'tweetnacl'

/**
 * Sign-In With Solana.
 *
 * The server never parses a message the client hands back. It rebuilds the
 * message from its own stored challenge and verifies the signature against
 * that. A client that alters the domain, the nonce, or the expiry simply
 * produces a signature over a string the server will not reconstruct, and the
 * check fails. Parsing attacker-controlled text and then trusting the fields
 * you parsed out of it is how these flows usually break.
 */

export type Challenge = {
  domain: string
  address: string
  nonce: string
  issuedAt: string
  expiresAt: string
  uri: string
}

export function buildSignInMessage(c: Challenge): string {
  return [
    `${c.domain} wants you to sign in with your Solana account:`,
    c.address,
    '',
    'Sign this message to prove you control this wallet. This is free and does not authorise any transaction.',
    '',
    `URI: ${c.uri}`,
    'Version: 1',
    `Nonce: ${c.nonce}`,
    `Issued At: ${c.issuedAt}`,
    `Expiration Time: ${c.expiresAt}`,
  ].join('\n')
}

/**
 * A wallet address must be a valid ed25519 point. Program-derived addresses
 * are deliberately off-curve and have no private key, so nothing can ever sign
 * for them — accepting one would create an account nobody can authenticate.
 */
export function isValidWalletAddress(address: string): boolean {
  try {
    const key = new PublicKey(address)
    return PublicKey.isOnCurve(key.toBytes())
  } catch {
    return false
  }
}

export function verifySignature(args: {
  message: string
  signatureBase58: string
  address: string
}): boolean {
  const { message, signatureBase58, address } = args
  try {
    if (!isValidWalletAddress(address)) return false

    const signature = bs58.decode(signatureBase58)
    if (signature.length !== 64) return false

    const publicKey = new PublicKey(address).toBytes()
    const messageBytes = new TextEncoder().encode(message)

    return nacl.sign.detached.verify(messageBytes, signature, publicKey)
  } catch {
    return false
  }
}

/** Verifies a challenge end to end: expiry first, then the signature. */
export function verifyChallenge(args: {
  challenge: Challenge
  signatureBase58: string
  now: Date
}): { ok: true } | { ok: false; reason: string } {
  const { challenge, signatureBase58, now } = args

  const expires = Date.parse(challenge.expiresAt)
  if (!Number.isFinite(expires)) return { ok: false, reason: 'challenge_malformed' }
  if (now.getTime() > expires) return { ok: false, reason: 'challenge_expired' }

  const message = buildSignInMessage(challenge)
  const ok = verifySignature({
    message,
    signatureBase58,
    address: challenge.address,
  })
  return ok ? { ok: true } : { ok: false, reason: 'signature_invalid' }
}
