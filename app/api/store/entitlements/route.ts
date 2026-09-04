import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { readSession, sessionCookie } from '@/lib/auth/session'
import { withRouteGuard } from '@/lib/api/guard'
import { features } from '@/lib/flags'
import { itemsForGame } from '@/lib/store/catalogue'
import { treasuryAddress } from '@/lib/store/treasury'
import { cluster, rpcUrl } from '@/lib/solana/rpc'
import { lamportsForUsd, solUsdRate } from '@/lib/store/pricing'

export const runtime = 'nodejs'

/**
 * What this wallet owns for one game, and what is for sale.
 *
 * Readable without owning anything — the catalogue is public, and a signed-out
 * caller simply owns nothing. It never returns another wallet's entitlements
 * because it only ever reads the session's own.
 */
async function handleGET(request: Request) {
  const slug = new URL(request.url).searchParams.get('game') ?? ''
  const items = itemsForGame(slug)

  const enabled = Boolean(features.payments && treasuryAddress() && rpcUrl())

  const jar = await cookies()
  const claims = await readSession(jar.get(sessionCookie.name)?.value)

  let owned: string[] = []
  if (claims && items.length > 0) {
    const rows = (await db()`
      SELECT item_id FROM entitlements
      WHERE wallet = ${claims.wallet} AND game_slug = ${slug}
    `) as Array<{ item_id: string }>
    owned = rows.map((r) => r.item_id)
  }

  // An indication, not a quote. The binding price is set by /api/store/intent
  // at the moment of purchase; this is only so the button can show what the
  // dollar price comes to right now.
  const rate = enabled && items.length > 0 ? await solUsdRate() : null

  return NextResponse.json({
    enabled,
    solUsdRate: rate,
    cluster: enabled ? cluster() : null,
    treasury: enabled ? treasuryAddress() : null,
    items: items.map((i) => ({
      id: i.id,
      name: i.name,
      description: i.description,
      kind: i.kind,
      usdCents: i.usdCents,
      estimatedLamports: rate ? (lamportsForUsd(i.usdCents, rate) as { lamports?: number }).lamports ?? null : null,
      owned: owned.includes(i.id),
    })),
  })
}

export const GET = withRouteGuard(handleGET)
