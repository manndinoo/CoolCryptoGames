import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { readSession, sessionCookie } from '@/lib/auth/session'
import { withRouteGuard } from '@/lib/api/guard'
import { getDemoGame } from '@/lib/content/demo'
import { parseSaveValues, type SaveValues } from '@/lib/play/save-bridge'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ slug: string }> }

/**
 * A wallet's progress in one game.
 *
 * Bound to the wallet rather than the browser, so a player who signs in on a
 * second device continues where they stopped instead of starting over. The
 * device copy stays as a fallback for playing signed out; the server copy is
 * the one that follows the account.
 *
 * The payload is validated here with the same parser the sandbox bridge uses —
 * the browser is not a trusted checkpoint, and a save arriving over HTTP has
 * had exactly as much opportunity to be edited as one arriving by postMessage.
 */
async function handleGET(_request: Request, ctx: Ctx) {
  const { slug } = await ctx.params
  if (!getDemoGame(slug)) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const jar = await cookies()
  const claims = await readSession(jar.get(sessionCookie.name)?.value)
  if (!claims) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 })

  const rows = (await db()`
    SELECT values, version, updated_at FROM game_saves
    WHERE wallet = ${claims.wallet} AND game_slug = ${slug}
  `) as Array<{ values: SaveValues; version: string; updated_at: Date }>

  const row = rows[0]
  return NextResponse.json({
    values: row?.values ?? {},
    version: row ? Number(row.version) : 0,
    updatedAt: row ? new Date(row.updated_at).toISOString() : null,
  })
}

async function handlePUT(request: Request, ctx: Ctx) {
  const { slug } = await ctx.params
  if (!getDemoGame(slug)) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const jar = await cookies()
  const claims = await readSession(jar.get(sessionCookie.name)?.value)
  if (!claims) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as { values?: unknown } | null
  const parsed = parseSaveValues(body?.values)
  if (!parsed.ok) {
    return NextResponse.json({ error: 'invalid_save', reason: parsed.reason }, { status: 400 })
  }

  // Last write wins, and the version tells a client that something else wrote
  // since it last read. There is no locking: this is one player's own progress
  // across their own devices, and the cost of the rare conflict is a level of
  // replay, not a lost account.
  const rows = (await db()`
    INSERT INTO game_saves (wallet, game_slug, values, version, updated_at)
    VALUES (${claims.wallet}, ${slug}, ${db().json(parsed.values)}, 1, now())
    ON CONFLICT (wallet, game_slug) DO UPDATE
      SET values = EXCLUDED.values,
          version = game_saves.version + 1,
          updated_at = now()
    RETURNING version
  `) as Array<{ version: string }>

  return NextResponse.json({ ok: true, version: Number(rows[0].version) })
}

export const GET = withRouteGuard(handleGET)
export const PUT = withRouteGuard(handlePUT)
