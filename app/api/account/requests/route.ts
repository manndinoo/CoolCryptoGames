import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { readSession, sessionCookie } from '@/lib/auth/session'
import { withRouteGuard } from '@/lib/api/guard'

export const runtime = 'nodejs'

const KINDS = ['data_export', 'deletion'] as const
type Kind = (typeof KINDS)[number]

const MAX_NOTE = 1_000

/**
 * Account requests: the player's side of the review queue.
 *
 * Deletion is a request rather than an action because the identity links a
 * cascade would take with it are the evidence that connects a wallet to the
 * rest of an abuse ring. Someone under investigation must not be able to erase
 * that by pressing a button, so a person decides, and the decision is recorded
 * where the player can see it.
 *
 * Nothing here promises a deadline. A stated turnaround this platform has no
 * staffing to meet would be a worse answer than an honest queue.
 */
async function handleGET() {
  const jar = await cookies()
  const claims = await readSession(jar.get(sessionCookie.name)?.value)
  if (!claims) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 })

  const rows = (await db()`
    SELECT id, kind, status, note, created_at, resolved_at, resolution
    FROM account_requests
    WHERE wallet = ${claims.wallet}
    ORDER BY created_at DESC
    LIMIT 50
  `) as Array<{
    id: string
    kind: Kind
    status: string
    note: string | null
    created_at: Date
    resolved_at: Date | null
    resolution: string | null
  }>

  return NextResponse.json({
    requests: rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      status: row.status,
      note: row.note,
      createdAt: new Date(row.created_at).toISOString(),
      resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
      resolution: row.resolution,
    })),
  })
}

async function handlePOST(request: Request) {
  const jar = await cookies()
  const claims = await readSession(jar.get(sessionCookie.name)?.value)
  if (!claims) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as {
    kind?: unknown
    note?: unknown
  } | null

  const kind = body?.kind
  if (typeof kind !== 'string' || !KINDS.includes(kind as Kind)) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }

  const note =
    typeof body?.note === 'string' && body.note.trim().length > 0
      ? body.note.trim().slice(0, MAX_NOTE)
      : null

  // The partial unique index allows one open request per kind. A second one is
  // not an error worth alarming anyone about — the ask is already recorded.
  const rows = (await db()`
    INSERT INTO account_requests (wallet, kind, note)
    VALUES (${claims.wallet}, ${kind}::account_request_kind, ${note})
    ON CONFLICT DO NOTHING
    RETURNING id, created_at
  `) as Array<{ id: string; created_at: Date }>

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, alreadyOpen: true })
  }

  return NextResponse.json(
    {
      ok: true,
      alreadyOpen: false,
      request: { id: rows[0].id, kind, createdAt: new Date(rows[0].created_at).toISOString() },
    },
    { status: 201 },
  )
}

export const GET = withRouteGuard(handleGET)
export const POST = withRouteGuard(handlePOST)
