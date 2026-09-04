import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { readSession, sessionCookie } from '@/lib/auth/session'

export const runtime = 'nodejs'

export async function GET() {
  const jar = await cookies()
  const claims = await readSession(jar.get(sessionCookie.name)?.value)
  if (!claims) return NextResponse.json({ wallet: null })
  return NextResponse.json({ wallet: claims.wallet })
}
