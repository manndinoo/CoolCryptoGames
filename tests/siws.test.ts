import { describe, expect, it } from 'vitest'
import bs58 from 'bs58'
import nacl from 'tweetnacl'
import {
  buildSignInMessage,
  isValidWalletAddress,
  verifyChallenge,
  verifySignature,
  type Challenge,
} from '@/lib/auth/siws'

function wallet() {
  const kp = nacl.sign.keyPair()
  return {
    address: bs58.encode(kp.publicKey),
    sign: (msg: string) =>
      bs58.encode(nacl.sign.detached(new TextEncoder().encode(msg), kp.secretKey)),
  }
}

function challenge(address: string, over: Partial<Challenge> = {}): Challenge {
  return {
    domain: 'coolcryptogames.fun',
    address,
    nonce: 'abc123nonce',
    issuedAt: '2026-09-04T12:00:00.000Z',
    expiresAt: '2026-09-04T12:05:00.000Z',
    uri: 'https://coolcryptogames.fun',
    ...over,
  }
}

describe('verifySignature', () => {
  it('accepts a signature from the matching wallet', () => {
    const w = wallet()
    const msg = buildSignInMessage(challenge(w.address))
    expect(
      verifySignature({ message: msg, signatureBase58: w.sign(msg), address: w.address }),
    ).toBe(true)
  })

  it('rejects a signature from a different wallet', () => {
    const a = wallet()
    const b = wallet()
    const msg = buildSignInMessage(challenge(a.address))
    expect(
      verifySignature({ message: msg, signatureBase58: b.sign(msg), address: a.address }),
    ).toBe(false)
  })

  it('rejects a signature over different text', () => {
    const w = wallet()
    const signed = buildSignInMessage(challenge(w.address))
    const checked = buildSignInMessage(challenge(w.address, { nonce: 'other-nonce' }))
    expect(
      verifySignature({ message: checked, signatureBase58: w.sign(signed), address: w.address }),
    ).toBe(false)
  })

  it('rejects malformed signatures without throwing', () => {
    const w = wallet()
    const msg = buildSignInMessage(challenge(w.address))
    expect(verifySignature({ message: msg, signatureBase58: 'not-base58!!', address: w.address })).toBe(false)
    expect(verifySignature({ message: msg, signatureBase58: bs58.encode(new Uint8Array(10)), address: w.address })).toBe(false)
  })
})

describe('isValidWalletAddress', () => {
  it('accepts a real ed25519 public key', () => {
    expect(isValidWalletAddress(wallet().address)).toBe(true)
  })

  it('rejects nonsense', () => {
    expect(isValidWalletAddress('hello')).toBe(false)
    expect(isValidWalletAddress('')).toBe(false)
  })

  it('rejects an off-curve address', () => {
    // Program-derived addresses have no private key, so nothing could ever
    // authenticate as one.
    const offCurve = 'BPFLoaderUpgradeab1e11111111111111111111111'
    expect(isValidWalletAddress(offCurve)).toBe(false)
  })
})

describe('verifyChallenge', () => {
  it('accepts a fresh, correctly signed challenge', () => {
    const w = wallet()
    const c = challenge(w.address)
    const sig = w.sign(buildSignInMessage(c))
    expect(
      verifyChallenge({ challenge: c, signatureBase58: sig, now: new Date('2026-09-04T12:01:00Z') }),
    ).toEqual({ ok: true })
  })

  it('rejects an expired challenge before checking the signature', () => {
    const w = wallet()
    const c = challenge(w.address)
    const sig = w.sign(buildSignInMessage(c))
    expect(
      verifyChallenge({ challenge: c, signatureBase58: sig, now: new Date('2026-09-04T12:06:00Z') }),
    ).toEqual({ ok: false, reason: 'challenge_expired' })
  })
})
