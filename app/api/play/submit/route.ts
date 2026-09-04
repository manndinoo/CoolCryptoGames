import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { readSession, sessionCookie } from '@/lib/auth/session'
import { getGameRules } from '@/lib/anticheat/registry'
import { validateSubmission } from '@/lib/anticheat/validate'
import type { InputEvent, PlaySessionRecord } from '@/lib/anticheat/types'

export const runtime = 'nodejs'

/** Refuse absurd payloads before parsing them into the validator. */
const MAX_INPUTS = 50_000

export async function POST(request: Request) {
  const jar = await cookies()
  const claims = await readSession(jar.get(sessionCookie.name)?.value)
  if (!claims) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as {
    sessionId?: unknown
    inputs?: unknown
    claimedScore?: unknown
  } | null

  if (typeof body?.sessionId !== 'string' || !Array.isArray(body.inputs)) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }
  if (body.inputs.length > MAX_INPUTS) {
    return NextResponse.json({ error: 'inputs_too_large' }, { status: 413 })
  }

  const sql = db()
  const rows = (await sql`
    SELECT id, game_slug, seed, started_at, last_heartbeat_at,
           heartbeat_count, max_gap_ms, status
    FROM play_sessions
    WHERE id = ${body.sessionId}::uuid AND wallet = ${claims.wallet}
  `) as Array<{
    id: string
    game_slug: string
    seed: string
    started_at: string
    last_heartbeat_at: string
    heartbeat_count: number
    max_gap_ms: string
    status: PlaySessionRecord['status']
  }>

  const row = rows[0]
  if (!row) return NextResponse.json({ error: 'session_not_found' }, { status: 404 })

  const rules = getGameRules(row.game_slug)
  if (!rules) return NextResponse.json({ error: 'game_not_scoreable' }, { status: 400 })

  const session: PlaySessionRecord = {
    id: row.id,
    gameSlug: row.game_slug,
    seed: row.seed,
    startedAt: new Date(row.started_at).getTime(),
    lastHeartbeatAt: new Date(row.last_heartbeat_at).getTime(),
    heartbeatCount: row.heartbeat_count,
    maxGapMs: Number(row.max_gap_ms),
    status: row.status,
  }

  const result = validateSubmission({
    rules,
    session,
    submission: {
      inputs: body.inputs as InputEvent[],
      claimedScore:
        typeof body.claimedScore === 'number' ? body.claimedScore : undefined,
    },
    now: Date.now(),
  })

  if (!result.ok) {
    // Kept rather than discarded: one rejection is noise, a pattern of them
    // against one wallet or device is what a ban decision is actually built on.
    await sql`
      UPDATE play_sessions SET status = 'rejected', ended_at = now() WHERE id = ${row.id}::uuid
    `
    await sql`
      INSERT INTO submission_rejections
        (play_session_id, wallet, game_slug, reasons, claimed_score, computed_score)
      VALUES (
        ${row.id}::uuid, ${claims.wallet}, ${row.game_slug}, ${result.reasons},
        ${typeof body.claimedScore === 'number' ? body.claimedScore : null},
        ${result.computedScore}
      )
    `
    return NextResponse.json({ accepted: false, reasons: result.reasons }, { status: 422 })
  }

  await sql`
    UPDATE play_sessions SET status = 'submitted', ended_at = now() WHERE id = ${row.id}::uuid
  `
  await sql`
    INSERT INTO scores (play_session_id, wallet, game_slug, score, duration_ms)
    VALUES (${row.id}::uuid, ${claims.wallet}, ${row.game_slug}, ${result.score}, ${result.durationMs})
    ON CONFLICT (play_session_id) DO NOTHING
  `

  return NextResponse.json({
    accepted: true,
    score: result.score,
    signals: result.signals,
  })
}
