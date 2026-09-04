import { randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { buildSignInMessage, isValidWalletAddress } from '@/lib/auth/siws'
import { banFor, resolveIdentity } from '@/lib/security/identity'
import { site } from '@/site.config'

export const runtime = 'nodejs'

const CHALLENGE_TTL_MS = 5 * 60 * 1000

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const address = (body as { address?: unknown })?.address

  if (typeof address !== 'string' || !isValidWalletAddress(address)) {
    return NextResponse.json({ error: 'invalid_address' }, { status: 400 })
  }

  const identity = await resolveIdentity({
    headers: request.headers,
    fingerprint: (body as { fingerprint?: unknown })?.fingerprint,
  })

  // Refuse before issuing anything, so a banned device cannot even collect a
  // challenge to grind signatures against.
  const ban = await banFor(identity, address)
  if (ban) {
    return NextResponse.json(
      { error: 'banned', reason: ban.reason, expiresAt: ban.expiresAt },
      { status: 403 },
    )
  }

  const nonce = randomBytes(24).toString('base64url')
  const issuedAt = new Date()
  const expiresAt = new Date(issuedAt.getTime() + CHALLENGE_TTL_MS)

  await db()`
    INSERT INTO auth_challenges (nonce, address, issued_at, expires_at, ip_hash)
    VALUES (${nonce}, ${address}, ${issuedAt.toISOString()}, ${expiresAt.toISOString()}, ${identity.ipHash})
  `

  const challenge = {
    domain: site.domain,
    address,
    nonce,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    uri: site.url,
  }

  return NextResponse.json({ nonce, message: buildSignInMessage(challenge) })
}
