import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { readSession, sessionCookie } from '@/lib/auth/session'
import { withRouteGuard } from '@/lib/api/guard'

export const runtime = 'nodejs'

async function handleGET() {
  const jar = await cookies()
  const claims = await readSession(jar.get(sessionCookie.name)?.value)
  if (!claims) return NextResponse.json({ wallet: null, username: null })

  // This route answers only for the caller's own session, so returning the
  // address here does not expose it to anyone else.
  return NextResponse.json({
    wallet: claims.wallet,
    username: claims.username,
    needsUsername: claims.username === null,
  })
}

export const GET = withRouteGuard(handleGET)
