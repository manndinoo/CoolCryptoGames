import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { readSession, sessionCookie } from '@/lib/auth/session'
import { checkEligibility } from '@/lib/tournaments/rules'
import { getDemoTournament } from '@/lib/content/demo'
import { findActiveBan } from '@/lib/security/bans'
import { withRouteGuard } from '@/lib/api/guard'

export const runtime = 'nodejs'

/**
 * Tournament entry.
 *
 * The client panel's checkbox and disabled button are presentation. Everything
 * that decides the outcome runs here: session, sanctions, event state, entry
 * window, and the exact rules version accepted.
 */
async function handlePOST(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params

  const jar = await cookies()
  const claims = await readSession(jar.get(sessionCookie.name)?.value)
  if (!claims) {
    return NextResponse.json({ error: 'not_eligible', reason: 'not_authenticated' }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as {
    acceptedRulesVersion?: unknown
  } | null

  const acceptedRulesVersion =
    typeof body?.acceptedRulesVersion === 'string' ? body.acceptedRulesVersion : null

  const tournament = getDemoTournament(slug)
  if (!tournament) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const ban = await findActiveBan({
    wallet: claims.wallet,
    deviceId: claims.deviceId || null,
    ipHash: claims.ipHash || null,
  })

  const eligibility = checkEligibility({
    tournament,
    now: new Date(),
    authenticated: true,
    acceptedRulesVersion,
    sanctioned: Boolean(ban),
  })

  if (!eligibility.eligible) {
    // The reason is a fixed enum with fixed player-facing copy. It says what to
    // do about the refusal without revealing how risk decisions are reached.
    return NextResponse.json({ error: 'not_eligible', reason: eligibility.reason }, { status: 403 })
  }

  // One entry per wallet per event; re-entering is a no-op rather than an error.
  await db()`
    INSERT INTO tournament_entries (tournament_slug, wallet, accepted_rules_version)
    VALUES (${slug}, ${claims.wallet}, ${tournament.rules.version})
    ON CONFLICT (tournament_slug, wallet)
      DO UPDATE SET
        accepted_rules_version = EXCLUDED.accepted_rules_version,
        accepted_at = now()
  `

  return NextResponse.json({ entered: true, rulesVersion: tournament.rules.version })
}

export const POST = withRouteGuard(handlePOST)
