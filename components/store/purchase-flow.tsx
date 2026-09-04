'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import { Providers } from '@/app/providers'

export type StoreItemView = {
  id: string
  name: string
  description: string
  kind: 'cosmetic' | 'content'
  /** The listed price, in whole cents. */
  usdCents: number
  /** What that comes to right now — an indication only. The binding SOL amount
   *  is the one the quote returns at the moment of purchase. */
  estimatedLamports: number | null
  owned: boolean
}

type Phase =
  | { at: 'quoting' }
  | { at: 'signing' }
  | { at: 'settling' }
  | { at: 'done' }
  | { at: 'failed'; message: string }

const COPY = {
  quoting: 'Preparing…',
  signing: 'Check your wallet. It will ask you to approve one transfer.',
  settling: 'Confirming on chain…',
  done: 'Paid and confirmed. It is attached to your wallet.',
} as const

/**
 * Buying one item.
 *
 * Split from the store listing because this half needs the wallet adapter and
 * the listing does not: a game page shows its store to everyone without
 * fetching the wallet stack, and that arrives when someone presses Buy.
 *
 * Three steps, and the client is trusted with none of them. The server quotes
 * the price and the recipient and stores them before the wallet is involved;
 * the wallet signs one plain transfer; the server then reads the chain's own
 * record of that transaction and decides. Nothing the browser says about the
 * payment is taken as fact.
 */
function Flow({
  gameSlug,
  item,
  onOwned,
}: {
  gameSlug: string
  item: StoreItemView
  onOwned: () => void
}) {
  const { publicKey, sendTransaction } = useWallet()
  const { connection } = useConnection()
  const [phase, setPhase] = useState<Phase>({ at: 'quoting' })
  const started = useRef(false)

  const buy = useCallback(async () => {
    if (!publicKey || !sendTransaction) {
      setPhase({ at: 'failed', message: 'Connect a wallet to buy this.' })
      return
    }

    try {
      setPhase({ at: 'quoting' })
      const quoteRes = await fetch('/api/store/intent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gameSlug, itemId: item.id }),
      })
      const quote = (await quoteRes.json()) as {
        intentId: string
        treasury: string
        reference: string
        lamports: number
        error?: string
      }
      if (!quoteRes.ok) {
        setPhase({
          at: 'failed',
          message:
            quote.error === 'already_owned'
              ? 'You already own this.'
              : 'Purchases are not available right now.',
        })
        return
      }

      // One transfer, player to treasury, carrying the quote's reference key as
      // a read-only account. That key is what makes this payment answer for
      // this purchase and no other.
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: new PublicKey(quote.treasury),
          lamports: quote.lamports,
        }),
      )
      tx.instructions[0].keys.push({
        pubkey: new PublicKey(quote.reference),
        isSigner: false,
        isWritable: false,
      })

      setPhase({ at: 'signing' })
      const signature = await sendTransaction(tx, connection)

      setPhase({ at: 'settling' })
      const settled = await confirmWithRetry(quote.intentId, signature)
      if (!settled.ok) {
        setPhase({ at: 'failed', message: settled.message })
        return
      }

      setPhase({ at: 'done' })
      onOwned()
    } catch (err) {
      const message = String((err as { message?: string })?.message ?? '')
      setPhase({
        at: 'failed',
        message: /reject|denied|cancel|user/i.test(message)
          ? 'Cancelled. Nothing was charged.'
          : 'That purchase could not be completed.',
      })
    }
  }, [publicKey, sendTransaction, connection, gameSlug, item.id, onOwned])

  // Pressing Buy was the decision; a second confirmation button would be a step
  // that exists only because the code was written in two passes.
  useEffect(() => {
    if (started.current) return
    started.current = true
    void buy()
  }, [buy])

  return (
    <p
      role="status"
      className={`mt-3 text-sm ${
        phase.at === 'failed'
          ? 'text-[var(--color-orange)]'
          : phase.at === 'done'
            ? 'text-[var(--color-success)]'
            : 'text-[var(--color-muted)]'
      }`}
    >
      {phase.at === 'failed' ? phase.message : COPY[phase.at]}
    </p>
  )
}

export function PurchaseFlow(props: {
  gameSlug: string
  item: StoreItemView
  onOwned: () => void
}) {
  return (
    <Providers>
      <Flow {...props} />
    </Providers>
  )
}

/**
 * A confirmed transaction is not instantly visible to every RPC node, so a
 * "not yet on chain" answer is met with another look rather than a refusal.
 * Every other rejection is final and returns at once.
 */
async function confirmWithRetry(
  intentId: string,
  signature: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch('/api/store/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ intentId, signature }),
    })
    const body = (await res.json().catch(() => ({}))) as { message?: string }
    if (res.ok) return { ok: true }
    if (res.status === 202 || res.status === 503) {
      await new Promise((r) => setTimeout(r, 1500))
      continue
    }
    return { ok: false, message: body.message ?? 'That payment could not be confirmed.' }
  }
  return {
    ok: false,
    message:
      'Your payment has not appeared on chain yet. It is not lost — reopen this page shortly and it will be granted.',
  }
}
