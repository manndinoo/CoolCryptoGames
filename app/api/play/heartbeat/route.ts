import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { readSession, sessionCookie } from '@/lib/auth/session'
import { withRouteGuard } from '@/lib/api/guard'

export const runtime = 'nodejs'

/**
 * Proof the client was connected and running throughout the session.
 *
 * The gap between consecutive beats is computed and kept as a running maximum,
 * so a client that disconnects to work on a run leaves a permanent mark on the
 * session even if it reconnects and beats normally afterwards.
 */
async function handlePOST(request: Request) {
  const jar = await cookies()
  const claims = await readSession(jar.get(sessionCookie.name)?.value)
  if (!claims) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as { sessionId?: unknown } | null
  if (typeof body?.sessionId !== 'string') {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }

  const rows = (await db()`
    UPDATE play_sessions
    SET
      max_gap_ms = GREATEST(
        max_gap_ms,
        EXTRACT(EPOCH FROM (now() - last_heartbeat_at)) * 1000
      )::bigint,
      last_heartbeat_at = now(),
      heartbeat_count = heartbeat_count + 1
    WHERE id = ${body.sessionId}::uuid
      AND wallet = ${claims.wallet}
      AND status = 'active'
    RETURNING heartbeat_count, max_gap_ms
  `) as Array<{ heartbeat_count: number; max_gap_ms: string }>

  if (!rows[0]) return NextResponse.json({ error: 'session_not_active' }, { status: 409 })
  return NextResponse.json({ ok: true, beats: rows[0].heartbeat_count })
}

export const POST = withRouteGuard(handlePOST)
