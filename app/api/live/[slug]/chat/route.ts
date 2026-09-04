import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { readSession, sessionCookie } from '@/lib/auth/session'
import { checkChatPermission, RATE_WINDOW_MS } from '@/lib/chat/rules'
import { displayName } from '@/lib/identity/username'
import { getDemoChannel } from '@/lib/content/demo'

export const runtime = 'nodejs'

const PAGE_SIZE = 100

type MessageRow = {
  id: string
  username: string | null
  body: string
  created_at: string
}

/**
 * Reading chat needs no wallet and no account, in line with "watch freely".
 * Removed messages are excluded rather than tombstoned in the feed.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params
  if (!getDemoChannel(slug)) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // Joined to wallets for the display name. The address itself never leaves
  // this query — a public feed must not carry it.
  const rows = (await db()`
    SELECT m.id, w.username, m.body, m.created_at
    FROM chat_messages m
    JOIN wallets w ON w.address = m.wallet
    WHERE m.channel_slug = ${slug} AND m.removed_at IS NULL
    ORDER BY m.created_at DESC
    LIMIT ${PAGE_SIZE}
  `) as MessageRow[]

  return NextResponse.json({
    messages: rows.reverse().map((r) => ({
      id: r.id,
      handle: displayName(r.username),
      body: r.body,
      at: r.created_at,
    })),
  })
}

/**
 * Posting requires a wallet session. Every limit is applied here rather than in
 * the client: a disabled send button is presentation, and a script posting
 * straight at this route never sees it.
 */
export async function POST(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params
  const channel = getDemoChannel(slug)
  if (!channel) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const jar = await cookies()
  const claims = await readSession(jar.get(sessionCookie.name)?.value)

  const body = (await request.json().catch(() => null)) as { text?: unknown } | null
  const text = typeof body?.text === 'string' ? body.text : ''

  const sql = db()

  // Channel chat settings, defaulting to on with no slow mode.
  const settings = (await sql`
    SELECT chat_enabled, slow_mode_ms FROM chat_channels WHERE slug = ${slug}
  `) as Array<{ chat_enabled: boolean; slow_mode_ms: number }>
  const chatEnabled = settings[0]?.chat_enabled ?? true
  const slowModeMs = settings[0]?.slow_mode_ms ?? 0

  // Everything below needs an identity. Gather its state only once we have one.
  let sanctioned = false
  let recentTimestamps: number[] = []
  let lastText: string | null = null

  if (claims) {
    const sanctions = (await sql`
      SELECT 1 FROM chat_sanctions
      WHERE wallet = ${claims.wallet}
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > now())
        AND (channel_slug IS NULL OR channel_slug = ${slug})
      LIMIT 1
    `) as Array<{ '?column?': number }>
    sanctioned = sanctions.length > 0

    const recent = (await sql`
      SELECT body, created_at
      FROM chat_messages
      WHERE wallet = ${claims.wallet}
        AND created_at > now() - (${RATE_WINDOW_MS} || ' milliseconds')::interval
      ORDER BY created_at DESC
    `) as Array<{ body: string; created_at: string }>

    recentTimestamps = recent.map((r) => new Date(r.created_at).getTime())
    lastText = recent[0]?.body ?? null
  }

  const decision = checkChatPermission(text, {
    authenticated: Boolean(claims),
    sanctioned,
    chatEnabled,
    slowModeMs,
    recentTimestamps,
    lastText,
    now: Date.now(),
  })

  if (!decision.allowed) {
    return NextResponse.json(
      { error: 'refused', reason: decision.reason, retryAfterMs: decision.retryAfterMs },
      { status: decision.reason === 'not_authenticated' ? 401 : 429 },
    )
  }

  const inserted = (await sql`
    INSERT INTO chat_messages (channel_slug, wallet, body)
    VALUES (${slug}, ${claims!.wallet}, ${decision.text})
    RETURNING id, created_at
  `) as Array<{ id: string; created_at: string }>

  return NextResponse.json({
    message: {
      id: inserted[0].id,
      handle: displayName(claims!.username),
      body: decision.text,
      at: inserted[0].created_at,
    },
  })
}
