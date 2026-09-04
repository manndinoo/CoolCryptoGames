import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyChallenge } from '@/lib/auth/siws'
import { issueSession, sessionCookie } from '@/lib/auth/session'
import { banFor, linkIdentity, resolveIdentity } from '@/lib/security/identity'
import { site } from '@/site.config'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    nonce?: unknown
    signature?: unknown
    fingerprint?: unknown
  } | null

  if (typeof body?.nonce !== 'string' || typeof body?.signature !== 'string') {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }

  const sql = db()

  // Consume the nonce atomically. Doing this before verification means a
  // replayed request loses the race even if the signature is genuine — a
  // captured signature is worth exactly one attempt.
  const rows = (await sql`
    UPDATE auth_challenges
    SET consumed_at = now()
    WHERE nonce = ${body.nonce} AND consumed_at IS NULL
    RETURNING address, issued_at, expires_at
  `) as Array<{ address: string; issued_at: string; expires_at: string }>

  const challengeRow = rows[0]
  if (!challengeRow) {
    return NextResponse.json({ error: 'challenge_unknown_or_used' }, { status: 400 })
  }

  const challenge = {
    domain: site.domain,
    address: challengeRow.address,
    nonce: body.nonce,
    issuedAt: new Date(challengeRow.issued_at).toISOString(),
    expiresAt: new Date(challengeRow.expires_at).toISOString(),
    uri: site.url,
  }

  const result = verifyChallenge({
    challenge,
    signatureBase58: body.signature,
    now: new Date(),
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 401 })
  }

  const wallet = challengeRow.address
  const identity = await resolveIdentity({
    headers: request.headers,
    fingerprint: body.fingerprint,
  })

  const ban = await banFor(identity, wallet)
  if (ban) {
    return NextResponse.json(
      { error: 'banned', reason: ban.reason, expiresAt: ban.expiresAt },
      { status: 403 },
    )
  }

  const walletRows = (await sql`
    INSERT INTO wallets (address)
    VALUES (${wallet})
    ON CONFLICT (address) DO UPDATE SET last_seen = now()
    RETURNING username
  `) as Array<{ username: string | null }>
  const username = walletRows[0]?.username ?? null
  await linkIdentity({ wallet, deviceId: identity.deviceId, ipHash: identity.ipHash })

  const token = await issueSession({
    wallet,
    deviceId: identity.deviceId ?? '',
    ipHash: identity.ipHash ?? '',
    username,
  })

  // The address is returned only to the person who just proved they control
  // it, so the client can show them which wallet they signed in with.
  const response = NextResponse.json({
    wallet,
    username,
    needsUsername: username === null,
  })
  response.cookies.set(sessionCookie.name, token, sessionCookie.options)
  return response
}
