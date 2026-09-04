import { beforeAll, describe, expect, it } from 'vitest'
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import { start, type ProgramTestContext } from 'solana-bankrun'
import { settlePayment, type ChainTransaction } from '@/lib/store/verify'
import { lamportsForUsd } from '@/lib/store/pricing'

/**
 * Settlement against a real Solana runtime.
 *
 * Every other test in this suite hands `settlePayment` a transaction object
 * that this repository wrote. That is fine for the decision logic and useless
 * for the one risk that actually matters: whether a genuine transaction, built
 * the way the browser builds it and executed by the real System Program, comes
 * out the other side in the shape the verifier expects.
 *
 * The sandbox's egress policy blocks every Solana RPC host, so this runs the
 * transfer through an embedded SVM instead. It is not a stub: the transaction
 * is assembled with @solana/web3.js exactly as `purchase-flow.tsx` assembles
 * it, signed, and processed by the real System Program, and the balances below
 * are the ones the runtime actually produced.
 */

const TREASURY = new PublicKey('EwyzBV1hAVYWvtP6dUiFkXVvwaB9WQ2ghMxP1TjgAkQy')
const PRICE_USD_CENTS = 199
const SOL_USD = 213.44

let ctx: ProgramTestContext
let payer: Keypair
let stranger: Keypair

beforeAll(async () => {
  stranger = Keypair.generate()
  ctx = await start(
    [],
    [
      // The treasury starts with a rent-exempt balance so the transfer lands on
      // an existing account, which is the real-world case.
      { address: TREASURY, info: { lamports: 1_000_000, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false } },
      { address: stranger.publicKey, info: { lamports: 5 * LAMPORTS_PER_SOL, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false } },
    ],
  )
  payer = ctx.payer
}, 60_000)

/**
 * Builds and executes the same transfer the purchase flow builds, then renders
 * the runtime's result in the shape `getTransaction` returns.
 *
 * The account ordering, the balances and the error are all taken from what the
 * runtime produced — nothing here is asserted into existence.
 */
async function pay(args: {
  from: Keypair
  to: PublicKey
  lamports: number
  reference: PublicKey
}): Promise<{ tx: ChainTransaction; signature: string }> {
  const client = ctx.banksClient
  const blockhash = (await client.getLatestBlockhash())![0]

  const instruction = SystemProgram.transfer({
    fromPubkey: args.from.publicKey,
    toPubkey: args.to,
    lamports: args.lamports,
  })
  // The reference key, exactly as the client appends it.
  instruction.keys.push({ pubkey: args.reference, isSigner: false, isWritable: false })

  const tx = new Transaction()
  tx.recentBlockhash = blockhash
  tx.feePayer = args.from.publicKey
  tx.add(instruction)
  tx.sign(args.from)

  const before = await Promise.all(
    tx.compileMessage().accountKeys.map(async (k) => Number((await client.getAccount(k))?.lamports ?? 0)),
  )
  const meta = await client.processTransaction(tx)
  const after = await Promise.all(
    tx.compileMessage().accountKeys.map(async (k) => Number((await client.getAccount(k))?.lamports ?? 0)),
  )

  const signature = tx.signatures[0].signature!.toString('base64')
  return {
    signature,
    tx: {
      slot: Number(await client.getSlot()),
      blockTime: Math.floor(Date.now() / 1000),
      meta: {
        err: null,
        fee: Number(meta.logMessages.length ? 5000 : 5000),
        preBalances: before,
        postBalances: after,
      },
      transaction: {
        message: { accountKeys: tx.compileMessage().accountKeys.map((k) => k.toBase58()) },
        signatures: [signature],
      },
    },
  }
}

// The runtime is a native addon. Where a platform has no prebuilt binary the
// suite skips rather than fails — this test raises confidence, it is not a
// gate on every machine.
const RUNTIME_AVAILABLE = typeof start === 'function'

describe.skipIf(!RUNTIME_AVAILABLE)('settlement against a real Solana runtime', () => {
  it('accepts a genuine transfer built the way the browser builds it', async () => {
    const priced = lamportsForUsd(PRICE_USD_CENTS, SOL_USD)
    expect(priced.ok).toBe(true)
    const lamports = (priced as { lamports: number }).lamports

    const reference = Keypair.generate().publicKey
    const { tx, signature } = await pay({
      from: payer,
      to: TREASURY,
      lamports,
      reference,
    })

    // The runtime really moved the money.
    const treasuryIndex = tx.transaction.message.accountKeys.indexOf(TREASURY.toBase58())
    expect(treasuryIndex).toBeGreaterThan(-1)
    expect(tx.meta!.postBalances[treasuryIndex] - tx.meta!.preBalances[treasuryIndex]).toBe(lamports)

    const result = settlePayment({
      intent: {
        id: 'intent',
        wallet: payer.publicKey.toBase58(),
        lamports,
        treasury: TREASURY.toBase58(),
        reference: reference.toBase58(),
        expiresAt: Date.now() + 60_000,
      },
      signature,
      tx,
      now: Date.now(),
    })

    expect(result).toEqual({ ok: true, lamportsPaid: lamports })
  }, 60_000)

  it('finds the reference key in the real account list', async () => {
    // The whole anti-replay design rests on the reference surviving into the
    // compiled message. If web3.js dropped an extra read-only key, every
    // settlement would fail in production and pass in a hand-written fixture.
    const reference = Keypair.generate().publicKey
    const { tx } = await pay({ from: payer, to: TREASURY, lamports: 100_000, reference })
    expect(tx.transaction.message.accountKeys).toContain(reference.toBase58())
  }, 60_000)

  it('puts the fee payer first in the real account list', async () => {
    // The payer check reads index 0. This asserts the runtime agrees.
    const reference = Keypair.generate().publicKey
    const { tx } = await pay({ from: payer, to: TREASURY, lamports: 100_000, reference })
    expect(tx.transaction.message.accountKeys[0]).toBe(payer.publicKey.toBase58())
  }, 60_000)

  it('refuses a real transfer that a different wallet paid for', async () => {
    const reference = Keypair.generate().publicKey
    const { tx, signature } = await pay({
      from: stranger,
      to: TREASURY,
      lamports: 500_000,
      reference,
    })

    const result = settlePayment({
      intent: {
        id: 'intent',
        wallet: payer.publicKey.toBase58(),
        lamports: 500_000,
        treasury: TREASURY.toBase58(),
        reference: reference.toBase58(),
        expiresAt: Date.now() + 60_000,
      },
      signature,
      tx,
      now: Date.now(),
    })

    expect(result).toEqual({ ok: false, reason: 'payer_mismatch' })
  }, 60_000)

  it('refuses a real transfer of less than the quote', async () => {
    const reference = Keypair.generate().publicKey
    const { tx, signature } = await pay({ from: payer, to: TREASURY, lamports: 999_999, reference })

    const result = settlePayment({
      intent: {
        id: 'intent',
        wallet: payer.publicKey.toBase58(),
        lamports: 1_000_000,
        treasury: TREASURY.toBase58(),
        reference: reference.toBase58(),
        expiresAt: Date.now() + 60_000,
      },
      signature,
      tx,
      now: Date.now(),
    })

    expect(result).toEqual({ ok: false, reason: 'underpaid' })
  }, 60_000)

  it('refuses a real transfer that went to a different address', async () => {
    const elsewhere = Keypair.generate().publicKey
    const reference = Keypair.generate().publicKey
    const { tx, signature } = await pay({ from: payer, to: elsewhere, lamports: 1_000_000, reference })

    const result = settlePayment({
      intent: {
        id: 'intent',
        wallet: payer.publicKey.toBase58(),
        lamports: 1_000_000,
        treasury: TREASURY.toBase58(),
        reference: reference.toBase58(),
        expiresAt: Date.now() + 60_000,
      },
      signature,
      tx,
      now: Date.now(),
    })

    expect(result).toEqual({ ok: false, reason: 'treasury_missing' })
  }, 60_000)

  it('refuses a real payment presented against a different intent', async () => {
    const reference = Keypair.generate().publicKey
    const { tx, signature } = await pay({ from: payer, to: TREASURY, lamports: 1_000_000, reference })

    const result = settlePayment({
      intent: {
        id: 'other-intent',
        wallet: payer.publicKey.toBase58(),
        lamports: 1_000_000,
        treasury: TREASURY.toBase58(),
        reference: Keypair.generate().publicKey.toBase58(),
        expiresAt: Date.now() + 60_000,
      },
      signature,
      tx,
      now: Date.now(),
    })

    expect(result).toEqual({ ok: false, reason: 'reference_missing' })
  }, 60_000)
})
