import { describe, expect, it } from 'vitest'
import { PublicKey } from '@solana/web3.js'
import { findItem, formatSol, LAMPORTS_PER_SOL, storeItems } from '@/lib/store/catalogue'
import { isValidAddress, treasuryAddress } from '@/lib/store/treasury'
import { settlePayment, type ChainTransaction, type IntentToSettle } from '@/lib/store/verify'

const WALLET = 'PLAYERwa11etAddress1111111111111111111111111'
const TREASURY = 'TREASURYwa11etAddress111111111111111111111'
const REFERENCE = 'REFERENCEkey1111111111111111111111111111111'
const SIGNATURE = 'SIGNATURE1111111111111111111111111111111111'
const PRICE = 0.05 * LAMPORTS_PER_SOL

const intent = (over: Partial<IntentToSettle> = {}): IntentToSettle => ({
  id: 'intent-1',
  wallet: WALLET,
  lamports: PRICE,
  treasury: TREASURY,
  reference: REFERENCE,
  expiresAt: 2_000,
  ...over,
})

/** A well-formed payment: player pays, treasury receives, reference present. */
function tx(over: {
  keys?: string[]
  pre?: number[]
  post?: number[]
  err?: unknown
  signatures?: string[]
  meta?: null
} = {}): ChainTransaction {
  const keys = over.keys ?? [WALLET, TREASURY, REFERENCE, '11111111111111111111111111111111']
  return {
    slot: 1,
    blockTime: 1,
    meta:
      over.meta === null
        ? null
        : {
            err: over.err ?? null,
            fee: 5000,
            preBalances: over.pre ?? [PRICE * 3, 100, 0, 1],
            postBalances: over.post ?? [PRICE * 2 - 5000, 100 + PRICE, 0, 1],
          },
    transaction: {
      message: { accountKeys: keys },
      signatures: over.signatures ?? [SIGNATURE],
    },
  }
}

describe('the store catalogue', () => {
  it('sells nothing that changes what a player can achieve', () => {
    // The type has two kinds and neither is competitive. This asserts the
    // shipped data has not drifted from that.
    for (const item of storeItems) {
      expect(['cosmetic', 'content']).toContain(item.kind)
    }
  })

  it('never prices an item at zero or below', () => {
    for (const item of storeItems) expect(item.lamports).toBeGreaterThan(0)
  })

  it('gives every item a description of what is actually bought', () => {
    for (const item of storeItems) expect(item.description.length).toBeGreaterThan(30)
  })

  it('scopes an item to one game', () => {
    expect(findItem('signal-brawl', 'zero-signal-neon')).toBeNull()
    expect(findItem('zero-signal', 'zero-signal-neon')?.id).toBe('zero-signal-neon')
  })

  it('shows a price without rounding it up', () => {
    expect(formatSol(0.05 * LAMPORTS_PER_SOL)).toBe('0.05 SOL')
    expect(formatSol(LAMPORTS_PER_SOL)).toBe('1 SOL')
  })
})

describe('treasury address', () => {
  it('accepts a real on-curve address', () => {
    expect(isValidAddress('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM')).toBe(true)
  })

  it('rejects junk and empty strings', () => {
    expect(isValidAddress('not-an-address')).toBe(false)
    expect(isValidAddress('')).toBe(false)
  })

  it('rejects an off-curve address', () => {
    // A program derived address has no private key, so anything sent to one
    // that was not built to receive it can never be spent again. Derived here
    // rather than hard-coded, because "looks like a program id" is not the
    // same as off-curve — the system program's own address is on the curve.
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('ccg-test')],
      new PublicKey('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'),
    )
    expect(PublicKey.isOnCurve(pda.toBytes())).toBe(false)
    expect(isValidAddress(pda.toBase58())).toBe(false)
  })
})

describe('settlePayment', () => {
  it('accepts a payment that matches the intent', () => {
    const r = settlePayment({ intent: intent(), signature: SIGNATURE, tx: tx(), now: 1_000 })
    expect(r).toEqual({ ok: true, lamportsPaid: PRICE })
  })

  it('accepts an overpayment and records what actually arrived', () => {
    const r = settlePayment({
      intent: intent(),
      signature: SIGNATURE,
      tx: tx({ post: [0, 100 + PRICE * 2, 0, 1] }),
      now: 1_000,
    })
    expect(r).toEqual({ ok: true, lamportsPaid: PRICE * 2 })
  })

  it('refuses a payment for less than the quote', () => {
    const r = settlePayment({
      intent: intent(),
      signature: SIGNATURE,
      tx: tx({ post: [0, 100 + PRICE - 1, 0, 1] }),
      now: 1_000,
    })
    expect(r).toEqual({ ok: false, reason: 'underpaid' })
  })

  it('refuses a payment that went to a different address', () => {
    const r = settlePayment({
      intent: intent(),
      signature: SIGNATURE,
      tx: tx({ keys: [WALLET, 'SOMEONEELSE111111111111111111111111111111', REFERENCE, 'x'] }),
      now: 1_000,
    })
    expect(r).toEqual({ ok: false, reason: 'treasury_missing' })
  })

  it('refuses somebody else’s payment to the same treasury', () => {
    // Without the payer check, a player could point at any real payment the
    // treasury ever received and claim an item from it.
    const r = settlePayment({
      intent: intent(),
      signature: SIGNATURE,
      tx: tx({ keys: ['OTHERPAYER11111111111111111111111111111111', TREASURY, REFERENCE, 'x'] }),
      now: 1_000,
    })
    expect(r).toEqual({ ok: false, reason: 'payer_mismatch' })
  })

  it('refuses a payment that does not carry this intent’s reference', () => {
    // Two purchases of equal value would otherwise be settleable by one
    // transfer presented twice.
    const r = settlePayment({
      intent: intent(),
      signature: SIGNATURE,
      tx: tx({ keys: [WALLET, TREASURY, 'DIFFERENTref11111111111111111111111111111', 'x'] }),
      now: 1_000,
    })
    expect(r).toEqual({ ok: false, reason: 'reference_missing' })
  })

  it('refuses a transaction that failed on chain', () => {
    const r = settlePayment({
      intent: intent(),
      signature: SIGNATURE,
      tx: tx({ err: { InstructionError: [0, 'Custom'] } }),
      now: 1_000,
    })
    expect(r).toEqual({ ok: false, reason: 'transaction_failed' })
  })

  it('refuses a signature the transaction does not carry', () => {
    const r = settlePayment({
      intent: intent(),
      signature: SIGNATURE,
      tx: tx({ signatures: ['SOMETHINGELSE1111111111111111111111111111'] }),
      now: 1_000,
    })
    expect(r).toEqual({ ok: false, reason: 'signature_mismatch' })
  })

  it('refuses an expired quote', () => {
    const r = settlePayment({ intent: intent(), signature: SIGNATURE, tx: tx(), now: 3_000 })
    expect(r).toEqual({ ok: false, reason: 'intent_expired' })
  })

  it('reports a transaction the cluster has not seen as absent, not as a refusal', () => {
    // A confirmed payment can take a moment to be visible, and refusing here
    // would lose real money.
    const r = settlePayment({ intent: intent(), signature: SIGNATURE, tx: null, now: 1_000 })
    expect(r).toEqual({ ok: false, reason: 'not_found' })
  })

  it('refuses a transaction with no metadata to read', () => {
    const r = settlePayment({ intent: intent(), signature: SIGNATURE, tx: tx({ meta: null }), now: 1_000 })
    expect(r).toEqual({ ok: false, reason: 'malformed' })
  })

  it('refuses balance arrays that do not line up with the accounts', () => {
    const r = settlePayment({
      intent: intent(),
      signature: SIGNATURE,
      tx: tx({ pre: [1, 2], post: [1, 2] }),
      now: 1_000,
    })
    expect(r).toEqual({ ok: false, reason: 'malformed' })
  })

  it('refuses an empty account list', () => {
    const r = settlePayment({
      intent: intent(),
      signature: SIGNATURE,
      tx: tx({ keys: [], pre: [], post: [] }),
      now: 1_000,
    })
    expect(r).toEqual({ ok: false, reason: 'malformed' })
  })
})

describe('the configured treasury', () => {
  it('is a valid, on-curve address a key can actually spend from', () => {
    // The one purchase failure that cannot be undone is paying into an address
    // nothing can sign for, so the committed default is asserted, not assumed.
    const treasury = treasuryAddress()
    expect(treasury).toBe('EwyzBV1hAVYWvtP6dUiFkXVvwaB9WQ2ghMxP1TjgAkQy')
    expect(isValidAddress(treasury!)).toBe(true)
    expect(PublicKey.isOnCurve(new PublicKey(treasury!).toBytes())).toBe(true)
  })

  it('lets an environment variable override it', () => {
    const previous = process.env.CCG_TREASURY_ADDRESS
    process.env.CCG_TREASURY_ADDRESS = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
    expect(treasuryAddress()).toBe('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM')
    if (previous === undefined) delete process.env.CCG_TREASURY_ADDRESS
    else process.env.CCG_TREASURY_ADDRESS = previous
  })

  it('reports a malformed override as absent rather than using it', () => {
    const previous = process.env.CCG_TREASURY_ADDRESS
    process.env.CCG_TREASURY_ADDRESS = 'not-an-address'
    expect(treasuryAddress()).toBeNull()
    if (previous === undefined) delete process.env.CCG_TREASURY_ADDRESS
    else process.env.CCG_TREASURY_ADDRESS = previous
  })
})
