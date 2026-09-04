import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { readSession, sessionCookie } from '@/lib/auth/session'
import { withRouteGuard } from '@/lib/api/guard'
import { features } from '@/lib/flags'
import { findItem } from '@/lib/store/catalogue'
import { getTransaction, RpcUnavailable } from '@/lib/solana/rpc'
import { settlementMessage, settlePayment } from '@/lib/store/verify'

export const runtime = 'nodejs'

/** Base58, 64 bytes — the shape of a Solana signature. */
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{80,100}$/

/**
 * Settles a quoted purchase against the chain.
 *
 * The client hands back one thing: a signature. Everything the decision rests
 * on is then read from the cluster's own record of that transaction and
 * compared against the intent this server issued — payer, recipient, amount and
 * reference. A client that lies about any of them is refused by the comparison
 * rather than believed.
 */
async function handlePOST(request: Request) {
  const jar = await cookies()
  const claims = await readSession(jar.get(sessionCookie.name)?.value)
  if (!claims) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 })
  if (!features.payments) {
    return NextResponse.json({ error: 'purchases_disabled' }, { status: 403 })
  }

  const body = (await request.json().catch(() => null)) as {
    intentId?: unknown
    signature?: unknown
  } | null

  if (
    typeof body?.intentId !== 'string' ||
    typeof body?.signature !== 'string' ||
    !SIGNATURE.test(body.signature)
  ) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }

  const sql = db()
  const rows = (await sql`
    SELECT id, wallet, game_slug, item_id, lamports, usd_cents, sol_usd_rate,
           treasury, reference, expires_at, settled_at
    FROM purchase_intents
    WHERE id = ${body.intentId}::uuid AND wallet = ${claims.wallet}
  `) as Array<{
    id: string
    wallet: string
    game_slug: string
    item_id: string
    lamports: string
    usd_cents: number | null
    sol_usd_rate: string | null
    treasury: string
    reference: string
    expires_at: Date
    settled_at: Date | null
  }>

  const intent = rows[0]
  if (!intent) return NextResponse.json({ error: 'unknown_intent' }, { status: 404 })

  const item = findItem(intent.game_slug, intent.item_id)
  if (!item) return NextResponse.json({ error: 'unknown_item' }, { status: 404 })

  let tx
  try {
    tx = await getTransaction(body.signature)
  } catch (err) {
    if (err instanceof RpcUnavailable) {
      console.error('[ccg] settlement RPC unavailable:', err.message)
      // Not the player's fault and not a refusal: the payment may well be good,
      // the server simply could not ask. Refusing here would lose a real
      // payment, so this asks them to retry rather than closing the intent.
      return NextResponse.json(
        { error: 'service_unavailable', reason: 'chain_unreachable' },
        { status: 503 },
      )
    }
    throw err
  }

  const decision = settlePayment({
    intent: {
      id: intent.id,
      wallet: intent.wallet,
      lamports: Number(intent.lamports),
      treasury: intent.treasury,
      reference: intent.reference,
      expiresAt: new Date(intent.expires_at).getTime(),
    },
    signature: body.signature,
    tx,
    now: Date.now(),
  })

  if (!decision.ok) {
    // "Not found" is a state, not a verdict — a confirmed transaction can take a
    // moment to be visible — so the intent stays open for another attempt.
    if (decision.reason !== 'not_found') {
      await sql`
        UPDATE purchase_intents SET rejected_reason = ${decision.reason} WHERE id = ${intent.id}::uuid
      `
    }
    return NextResponse.json(
      { error: 'not_settled', reason: decision.reason, message: settlementMessage(decision.reason) },
      { status: decision.reason === 'not_found' ? 202 : 400 },
    )
  }

  // The signature column is UNIQUE, so a payment presented twice — against this
  // intent or any other — inserts nothing the second time.
  const granted = (await sql`
    INSERT INTO entitlements
      (wallet, game_slug, item_id, kind, lamports_paid, usd_cents, sol_usd_rate, signature, intent_id)
    VALUES (${claims.wallet}, ${item.gameSlug}, ${item.id}, ${item.kind},
            ${decision.lamportsPaid}, ${intent.usd_cents}, ${intent.sol_usd_rate},
            ${body.signature}, ${intent.id}::uuid)
    ON CONFLICT DO NOTHING
    RETURNING id, created_at
  `) as Array<{ id: string; created_at: Date }>

  await sql`
    UPDATE purchase_intents SET settled_at = now(), rejected_reason = NULL WHERE id = ${intent.id}::uuid
  `

  return NextResponse.json({
    owned: true,
    // False when the row already existed, which is the honest answer to a
    // retried confirmation rather than a second grant.
    granted: granted.length > 0,
    item: { id: item.id, name: item.name, kind: item.kind },
    signature: body.signature,
  })
}

export const POST = withRouteGuard(handlePOST)
