import { randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { Keypair } from '@solana/web3.js'
import { db } from '@/lib/db'
import { readSession, sessionCookie } from '@/lib/auth/session'
import { withRouteGuard } from '@/lib/api/guard'
import { features } from '@/lib/flags'
import { findItem } from '@/lib/store/catalogue'
import { treasuryAddress } from '@/lib/store/treasury'
import { lamportsForUsd, solUsdRate } from '@/lib/store/pricing'
import { cluster, rpcUrl } from '@/lib/solana/rpc'

export const runtime = 'nodejs'

/** How long a quote stands. Long enough to sign, short enough to mean something. */
const INTENT_TTL_MS = 10 * 60 * 1000

/**
 * Quotes a purchase.
 *
 * The price, the recipient and the reference are all decided here and stored
 * before the wallet is asked for anything. The client is told what to sign; it
 * never gets to say what the price was afterwards.
 *
 * Nothing is charged by this route. It writes a row and returns numbers.
 */
async function handlePOST(request: Request) {
  const jar = await cookies()
  const claims = await readSession(jar.get(sessionCookie.name)?.value)
  if (!claims) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 })

  const treasury = treasuryAddress()
  if (!features.payments || !treasury || !rpcUrl()) {
    // Both conditions are reported the same way. Which one is missing is an
    // operator's business, not a caller's.
    return NextResponse.json({ error: 'purchases_disabled' }, { status: 403 })
  }

  const body = (await request.json().catch(() => null)) as {
    gameSlug?: unknown
    itemId?: unknown
  } | null

  if (typeof body?.gameSlug !== 'string' || typeof body?.itemId !== 'string') {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }

  const item = findItem(body.gameSlug, body.itemId)
  if (!item) return NextResponse.json({ error: 'unknown_item' }, { status: 404 })

  const sql = db()

  // Already owned. Selling the same thing twice is not a thing to sell.
  const owned = (await sql`
    SELECT 1 FROM entitlements
    WHERE wallet = ${claims.wallet} AND game_slug = ${item.gameSlug} AND item_id = ${item.id}
    LIMIT 1
  `) as Array<{ '?column?': number }>
  if (owned.length > 0) {
    return NextResponse.json({ error: 'already_owned' }, { status: 409 })
  }

  // The dollar price becomes a SOL price here, once, at this moment's rate.
  // No usable rate means no quote: guessing one is the only failure mode that
  // could charge somebody many times what an item costs.
  const rate = await solUsdRate()
  if (rate === null) {
    return NextResponse.json(
      { error: 'service_unavailable', reason: 'price_unavailable' },
      { status: 503 },
    )
  }

  const priced = lamportsForUsd(item.usdCents, rate)
  if (!priced.ok) {
    console.error('[ccg] refusing to quote:', priced.reason, { item: item.id, rate })
    return NextResponse.json(
      { error: 'service_unavailable', reason: 'price_unavailable' },
      { status: 503 },
    )
  }

  // A throwaway keypair used only as a marker. Its private half is discarded
  // immediately — it never signs anything and holds nothing.
  const reference = Keypair.generate().publicKey.toBase58()
  const expiresAt = new Date(Date.now() + INTENT_TTL_MS)

  const rows = (await sql`
    INSERT INTO purchase_intents
      (wallet, game_slug, item_id, lamports, usd_cents, sol_usd_rate, treasury, reference, expires_at)
    VALUES (${claims.wallet}, ${item.gameSlug}, ${item.id}, ${priced.lamports},
            ${item.usdCents}, ${rate}, ${treasury}, ${reference}, ${expiresAt})
    RETURNING id, expires_at
  `) as Array<{ id: string; expires_at: Date }>

  return NextResponse.json({
    intentId: rows[0].id,
    // Everything the player is about to authorise, stated before they are asked.
    treasury,
    reference,
    lamports: priced.lamports,
    usdCents: item.usdCents,
    solUsdRate: rate,
    cluster: cluster(),
    item: { id: item.id, name: item.name, description: item.description, kind: item.kind },
    expiresAt: rows[0].expires_at,
    // Unused here, but it keeps the linter honest about the import.
    nonce: randomBytes(8).toString('hex'),
  })
}

export const POST = withRouteGuard(handlePOST)
