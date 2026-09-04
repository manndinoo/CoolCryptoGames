import { SignJWT, jwtVerify } from 'jose'

const COOKIE_NAME = 'ccg_session'
const MAX_AGE_SECONDS = 60 * 60 * 12

export type SessionClaims = {
  wallet: string
  deviceId: string
  /** Bound so a stolen cookie replayed from elsewhere is detectable. */
  ipHash: string
}

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET
  if (!s || s.length < 32) {
    throw new Error('SESSION_SECRET must be set to at least 32 characters')
  }
  return new TextEncoder().encode(s)
}

export async function issueSession(claims: SessionClaims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secret())
}

export async function readSession(token: string | undefined): Promise<SessionClaims | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secret())
    const { wallet, deviceId, ipHash } = payload as Record<string, unknown>
    if (typeof wallet !== 'string' || typeof deviceId !== 'string' || typeof ipHash !== 'string') {
      return null
    }
    return { wallet, deviceId, ipHash }
  } catch {
    return null
  }
}

export const sessionCookie = {
  name: COOKIE_NAME,
  maxAge: MAX_AGE_SECONDS,
  options: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  },
}
