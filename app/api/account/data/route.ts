import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { readSession, sessionCookie } from '@/lib/auth/session'
import { findActiveBan } from '@/lib/security/bans'
import { withRouteGuard } from '@/lib/api/guard'

export const runtime = 'nodejs'

/**
 * Everything this platform holds about the caller, returned to the caller.
 *
 * Three deliberate omissions, each for a reason worth stating.
 *
 * Other people's identities. A device or network row here is shown as the
 * caller's own link to it, never as a list of who else has used it. The links
 * table exists to investigate abuse rings; exporting it would turn a privacy
 * feature into a way to find out who else lives in your building.
 *
 * Peppered hashes. The device and network hashes are derived with a secret
 * pepper. They identify nothing to the person reading them and would only
 * serve to help someone check whether a device they control is the one on
 * record.
 *
 * Rejection reason codes. A rejected submission is reported with its date and
 * the fact of the decision, not the check that fired. Publishing which rule
 * caught a run tells anyone who wants to defeat it exactly what to change.
 * A person reviewing an appeal can see and explain the detail; an automatic
 * export cannot do that without also handing it to the next attempt.
 */
async function handleGET() {
  const jar = await cookies()
  const claims = await readSession(jar.get(sessionCookie.name)?.value)
  if (!claims) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 })

  const sql = db()
  const wallet = claims.wallet

  const [account] = (await sql`
    SELECT address, username, username_set_at, first_seen, last_seen
    FROM wallets WHERE address = ${wallet}
  `) as Array<{
    address: string
    username: string | null
    username_set_at: Date | null
    first_seen: Date
    last_seen: Date
  }>

  if (!account) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const devices = (await sql`
    SELECT count(DISTINCT device_id)::int AS n,
           min(first_seen) AS first_seen,
           max(last_seen)  AS last_seen
    FROM identity_links WHERE wallet = ${wallet}
  `) as Array<{ n: number; first_seen: Date | null; last_seen: Date | null }>

  // The truncated display form only — a /24 for IPv4, a /64 for IPv6. The
  // address itself was never stored, so it cannot be exported.
  const networks = (await sql`
    SELECT DISTINCT r.ip_display, min(l.first_seen) AS first_seen, max(l.last_seen) AS last_seen
    FROM identity_links l
    JOIN ip_records r ON r.ip_hash = l.ip_hash
    WHERE l.wallet = ${wallet}
    GROUP BY r.ip_display
    ORDER BY max(l.last_seen) DESC
  `) as Array<{ ip_display: string; first_seen: Date; last_seen: Date }>

  const sessions = (await sql`
    SELECT game_slug, started_at, ended_at, status
    FROM play_sessions WHERE wallet = ${wallet}
    ORDER BY started_at DESC LIMIT 500
  `) as Array<{ game_slug: string; started_at: Date; ended_at: Date | null; status: string }>

  const scores = (await sql`
    SELECT game_slug, score, duration_ms, created_at
    FROM scores WHERE wallet = ${wallet}
    ORDER BY created_at DESC LIMIT 500
  `) as Array<{ game_slug: string; score: string; duration_ms: string; created_at: Date }>

  const rejections = (await sql`
    SELECT game_slug, created_at
    FROM submission_rejections WHERE wallet = ${wallet}
    ORDER BY created_at DESC LIMIT 500
  `) as Array<{ game_slug: string; created_at: Date }>

  const entries = (await sql`
    SELECT tournament_slug, accepted_rules_version, accepted_at
    FROM tournament_entries WHERE wallet = ${wallet}
    ORDER BY accepted_at DESC
  `) as Array<{ tournament_slug: string; accepted_rules_version: string; accepted_at: Date }>

  const requests = (await sql`
    SELECT kind, status, note, created_at, resolved_at, resolution
    FROM account_requests WHERE wallet = ${wallet}
    ORDER BY created_at DESC
  `) as Array<{
    kind: string
    status: string
    note: string | null
    created_at: Date
    resolved_at: Date | null
    resolution: string | null
  }>

  const ban = await findActiveBan({ wallet })

  return NextResponse.json(
    {
      exportedAt: new Date().toISOString(),
      account: {
        // The caller's own address, returned only to the session that proved
        // control of it. No other surface emits this column.
        walletAddress: account.address,
        username: account.username,
        usernameSetAt: iso(account.username_set_at),
        firstSeen: iso(account.first_seen),
        lastSeen: iso(account.last_seen),
      },
      devices: {
        linkedCount: devices[0]?.n ?? 0,
        firstSeen: iso(devices[0]?.first_seen ?? null),
        lastSeen: iso(devices[0]?.last_seen ?? null),
        note: 'Device identifiers are stored as peppered hashes and are not reversible to a device.',
      },
      networks: networks.map((n) => ({
        network: n.ip_display,
        firstSeen: iso(n.first_seen),
        lastSeen: iso(n.last_seen),
      })),
      playSessions: sessions.map((s) => ({
        game: s.game_slug,
        startedAt: iso(s.started_at),
        endedAt: iso(s.ended_at),
        status: s.status,
      })),
      verifiedScores: scores.map((s) => ({
        game: s.game_slug,
        score: Number(s.score),
        durationMs: Number(s.duration_ms),
        recordedAt: iso(s.created_at),
      })),
      rejectedSubmissions: rejections.map((r) => ({
        game: r.game_slug,
        at: iso(r.created_at),
        note: 'Not accepted. Raise an appeal for a person to explain the decision.',
      })),
      tournamentEntries: entries.map((e) => ({
        tournament: e.tournament_slug,
        acceptedRulesVersion: e.accepted_rules_version,
        acceptedAt: iso(e.accepted_at),
      })),
      accountRequests: requests.map((r) => ({
        kind: r.kind,
        status: r.status,
        note: r.note,
        createdAt: iso(r.created_at),
        resolvedAt: iso(r.resolved_at),
        resolution: r.resolution,
      })),
      sanctions: ban
        ? [{ reason: ban.reason, expiresAt: ban.expiresAt, appliesTo: 'this wallet' }]
        : [],
    },
    {
      headers: {
        'content-disposition': 'attachment; filename="ccg-account-data.json"',
        'cache-control': 'no-store',
      },
    },
  )
}

function iso(value: Date | string | null): string | null {
  return value ? new Date(value).toISOString() : null
}

export const GET = withRouteGuard(handleGET)
