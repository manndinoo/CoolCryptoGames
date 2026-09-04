import { randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { readSession, sessionCookie } from '@/lib/auth/session'
import { getGameRules } from '@/lib/anticheat/registry'
import { banFor, linkIdentity, resolveIdentity } from '@/lib/security/identity'
import { HEARTBEAT_INTERVAL_MS } from '@/lib/anticheat/constants'
import { withRouteGuard } from '@/lib/api/guard'

export const runtime = 'nodejs'

async function handlePOST(request: Request) {
  const jar = await cookies()
  const claims = await readSession(jar.get(sessionCookie.name)?.value)
  if (!claims) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as {
    gameSlug?: unknown
    fingerprint?: unknown
  } | null

  if (typeof body?.gameSlug !== 'string') {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }

  const rules = getGameRules(body.gameSlug)
  if (!rules) {
    // No server-side simulation means no score this server can vouch for.
    return NextResponse.json({ error: 'game_not_scoreable' }, { status: 400 })
  }

  const identity = await resolveIdentity({
    headers: request.headers,
    fingerprint: body.fingerprint,
  })

  // A client that sends no usable fingerprint gets no ranked run. Otherwise
  // withholding it would be the way to opt out of device tracking entirely.
  if (!identity.deviceId) {
    return NextResponse.json({ error: 'fingerprint_required' }, { status: 400 })
  }

  const ban = await banFor(identity, claims.wallet)
  if (ban) {
    return NextResponse.json(
      { error: 'banned', reason: ban.reason, expiresAt: ban.expiresAt },
      { status: 403 },
    )
  }

  await linkIdentity({
    wallet: claims.wallet,
    deviceId: identity.deviceId,
    ipHash: identity.ipHash,
  })

  const sql = db()

  // Abandon any run this wallet left open, so one wallet cannot hold several
  // sessions and submit whichever turned out best.
  await sql`
    UPDATE play_sessions
    SET status = 'abandoned', ended_at = now()
    WHERE wallet = ${claims.wallet} AND status = 'active'
  `

  // The seed is the server's. The client cannot search for a favourable one.
  const seed = randomBytes(16).toString('hex')

  const rows = (await sql`
    INSERT INTO play_sessions (wallet, game_slug, seed, device_id, ip_hash)
    VALUES (${claims.wallet}, ${rules.slug}, ${seed}, ${identity.deviceId}::uuid, ${identity.ipHash})
    RETURNING id, started_at
  `) as Array<{ id: string; started_at: string }>

  return NextResponse.json({
    sessionId: rows[0].id,
    seed,
    startedAt: rows[0].started_at,
    heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
  })
}

export const POST = withRouteGuard(handlePOST)
