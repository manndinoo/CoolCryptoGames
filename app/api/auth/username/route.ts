import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { issueSession, readSession, sessionCookie } from '@/lib/auth/session'
import { checkUsername } from '@/lib/identity/username'
import { withRouteGuard } from '@/lib/api/guard'

export const runtime = 'nodejs'

/** Availability check for the setup form. Requires a session, so it cannot be
 *  used anonymously to enumerate who exists. */
async function handleGET(request: Request) {
  const jar = await cookies()
  const claims = await readSession(jar.get(sessionCookie.name)?.value)
  if (!claims) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 })

  const proposed = new URL(request.url).searchParams.get('name') ?? ''
  const check = checkUsername(proposed)
  if (!check.valid) return NextResponse.json({ available: false, reason: check.reason })

  const rows = (await db()`
    SELECT 1 AS taken FROM wallets WHERE lower(username) = ${check.key} LIMIT 1
  `) as Array<{ taken: number }>

  return NextResponse.json({ available: rows.length === 0, reason: rows.length ? 'taken' : null })
}

/**
 * Claims a username for the signed-in wallet.
 *
 * The session is reissued afterwards because it carries the username, and a
 * stale cookie would keep rendering the player as unnamed until it expired.
 */
async function handlePOST(request: Request) {
  const jar = await cookies()
  const claims = await readSession(jar.get(sessionCookie.name)?.value)
  if (!claims) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as { username?: unknown } | null
  const check = checkUsername(typeof body?.username === 'string' ? body.username : '')
  if (!check.valid) {
    return NextResponse.json({ error: 'invalid', reason: check.reason }, { status: 400 })
  }

  const sql = db()

  // Only sets a name where one is absent. A username is a public identity that
  // other players learn to recognise, so it is not silently reassignable —
  // changing it is a separate, rate-limited operation, not this route.
  //
  // The availability check above is advisory: between it and this write another
  // wallet can claim the same name, and the case-insensitive unique index is
  // what actually decides. That surfaces as a constraint violation rather than
  // an empty result, so it has to be caught rather than inferred from row count.
  let updated: Array<{ username: string }>
  try {
    updated = (await sql`
      UPDATE wallets
      SET username = ${check.username}, username_set_at = now()
      WHERE address = ${claims.wallet} AND username IS NULL
      RETURNING username
    `) as Array<{ username: string }>
  } catch (err) {
    if (isUniqueViolation(err)) {
      return NextResponse.json({ error: 'invalid', reason: 'taken' }, { status: 409 })
    }
    throw err
  }

  if (updated.length === 0) {
    // Either this wallet already has a name, or the unique index rejected the
    // write. Distinguish, so the form can say something useful.
    const existing = (await sql`
      SELECT username FROM wallets WHERE address = ${claims.wallet}
    `) as Array<{ username: string | null }>

    if (existing[0]?.username) {
      return NextResponse.json(
        { error: 'already_set', username: existing[0].username },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: 'invalid', reason: 'taken' }, { status: 409 })
  }

  const token = await issueSession({ ...claims, username: updated[0].username })
  const response = NextResponse.json({ username: updated[0].username })
  response.cookies.set(sessionCookie.name, token, sessionCookie.options)
  return response
}

/** Postgres unique-violation SQLSTATE. */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505'
}

export const GET = withRouteGuard(handleGET)
export const POST = withRouteGuard(handlePOST)
