import { SignJWT, jwtVerify } from 'jose'

/**
 * Play capabilities.
 *
 * Authenticating does not launch a game. A capability is a separate, short
 * lived token scoped to one game, one immutable build, and one match, and it
 * is the only credential the game frame ever sees. It is deliberately not the
 * platform session: the frame runs untrusted third-party code, so handing it
 * anything reusable — or anything that identifies the player beyond this one
 * run — would defeat the isolation the frame exists to provide.
 *
 * Note what a capability does NOT carry: the wallet address, the username, the
 * platform session, or any wallet provider access. A game learns that some
 * player is playing this match, and nothing else about them.
 */

export type PlayCapability = {
  /** Unique per issue. Lets a single-use policy be enforced server-side. */
  capabilityId: string
  matchId: string
  playSessionId: string
  gameSlug: string
  /** Exact build this capability is good for. A tournament binds to this. */
  buildHash: string
  /** Actions this capability permits. The frame may do nothing else. */
  actions: readonly ('score' | 'telemetry' | 'save')[]
}

const DEFAULT_TTL_SECONDS = 900

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET
  if (!s || s.length < 32) {
    throw new Error('SESSION_SECRET must be set to at least 32 characters')
  }
  // Domain-separated from the platform session key material, so a capability
  // can never be presented as a session or the reverse.
  return new TextEncoder().encode(`${s}:play-capability`)
}

export function capabilityTtlSeconds(): number {
  const raw = Number(process.env.PLAY_CAPABILITY_TTL_SECONDS ?? DEFAULT_TTL_SECONDS)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TTL_SECONDS
}

export async function issueCapability(capability: PlayCapability): Promise<string> {
  return new SignJWT({ ...capability })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${capabilityTtlSeconds()}s`)
    .setAudience('ccg:play')
    .sign(secret())
}

export async function readCapability(token: string | undefined): Promise<PlayCapability | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secret(), { audience: 'ccg:play' })
    const { capabilityId, matchId, playSessionId, gameSlug, buildHash, actions } =
      payload as Record<string, unknown>

    if (
      typeof capabilityId !== 'string' ||
      typeof matchId !== 'string' ||
      typeof playSessionId !== 'string' ||
      typeof gameSlug !== 'string' ||
      typeof buildHash !== 'string' ||
      !Array.isArray(actions)
    ) {
      return null
    }

    return {
      capabilityId,
      matchId,
      playSessionId,
      gameSlug,
      buildHash,
      actions: actions.filter(
        (a): a is 'score' | 'telemetry' | 'save' =>
          a === 'score' || a === 'telemetry' || a === 'save',
      ),
    }
  } catch {
    return null
  }
}

/**
 * Whether a capability authorises an action against a specific game and build.
 *
 * Both are checked, not just the game. A tournament binds to an exact build
 * hash, so a capability issued for build A must not be spendable against build
 * B even when the game slug matches — that is the difference between "this game"
 * and "the version of this game the event was run on".
 */
export function capabilityPermits(
  capability: PlayCapability,
  args: { gameSlug: string; buildHash: string; action: 'score' | 'telemetry' | 'save' },
): boolean {
  return (
    capability.gameSlug === args.gameSlug &&
    capability.buildHash === args.buildHash &&
    capability.actions.includes(args.action)
  )
}
