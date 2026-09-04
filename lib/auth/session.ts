import { SignJWT, jwtVerify } from 'jose'
import { getSecret } from '@/lib/secrets'

const COOKIE_NAME = 'ccg_session'
const MAX_AGE_SECONDS = 60 * 60 * 12

export type SessionClaims = {
  wallet: string
  deviceId: string
  /** Bound so a stolen cookie replayed from elsewhere is detectable. */
  ipHash: string
  /**
   * Public identity. Null until the player has chosen one — an account is
   * authenticated before it is named, and no public surface may fall back to
   * the address in the meantime.
   */
  username: string | null
}

async function secret(): Promise<Uint8Array> {
  return new TextEncoder().encode(await getSecret('SESSION_SECRET'))
}

export async function issueSession(claims: SessionClaims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(await secret())
}

export async function readSession(token: string | undefined): Promise<SessionClaims | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, await secret())
    const { wallet, deviceId, ipHash, username } = payload as Record<string, unknown>
    if (typeof wallet !== 'string' || typeof deviceId !== 'string' || typeof ipHash !== 'string') {
      return null
    }
    return {
      wallet,
      deviceId,
      ipHash,
      username: typeof username === 'string' ? username : null,
    }
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
