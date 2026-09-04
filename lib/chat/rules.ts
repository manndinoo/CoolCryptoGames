/**
 * Chat rules.
 *
 * Chat is **open** — anyone can join a channel and talk, not a pre-approved
 * list. It is not **anonymous**: posting requires a wallet session, so every
 * message is attributable to an identity that can be muted, timed out or
 * banned. Those two words get used interchangeably and they are not the same
 * thing; the founding product excludes the second, not the first.
 *
 * Reading is open to everyone, with no wallet and no account, in line with
 * "browse freely, watch freely".
 *
 * Everything here is pure, so the limits are testable directly.
 */

export const MAX_MESSAGE_LENGTH = 400
export const RATE_WINDOW_MS = 30_000
export const MAX_MESSAGES_PER_WINDOW = 8

export type ChatDenyReason =
  | 'not_authenticated'
  | 'sanctioned'
  | 'chat_disabled'
  | 'slow_mode'
  | 'rate_limited'
  | 'duplicate'
  | 'empty'
  | 'too_long'

export type ChatPermission =
  | { allowed: true; text: string }
  | { allowed: false; reason: ChatDenyReason; retryAfterMs?: number }

const TAB = 0x09
const LINE_FEED = 0x0a
const CARRIAGE_RETURN = 0x0d

/**
 * Characters removed outright: C0 controls, DEL, the C1 range, and the
 * zero-width family.
 *
 * Control characters carry no meaning in chat and are the usual way people
 * smuggle line noise, invisible payloads or terminal escapes through a text
 * field. Zero-width characters go for a different reason — they are how a
 * "unique" message slips past a duplicate check while looking identical to
 * everyone reading it.
 */
function isStrippable(cp: number): boolean {
  if (cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f)) return true
  return cp === 0x200b || cp === 0x200c || cp === 0x200d || cp === 0xfeff
}

/** Normalises message text before it is validated, stored or compared. */
export function normalizeMessage(raw: string): string {
  let out = ''
  for (const ch of raw) {
    const cp = ch.codePointAt(0)
    if (cp === undefined) continue

    // Real whitespace becomes a space rather than vanishing, so "a\nb" reads
    // as two words instead of one.
    if (cp === TAB || cp === LINE_FEED || cp === CARRIAGE_RETURN) {
      out += ' '
      continue
    }
    if (isStrippable(cp)) continue
    out += ch
  }
  return out.replace(/\s+/g, ' ').trim()
}

export type ChatContext = {
  authenticated: boolean
  sanctioned: boolean
  chatEnabled: boolean
  /** Minimum gap between one identity's messages. 0 disables slow mode. */
  slowModeMs: number
  /** This identity's recent message times, newest first. */
  recentTimestamps: number[]
  /** This identity's last message text, for the duplicate check. */
  lastText: string | null
  now: number
}

/**
 * Whether a message may be posted, and the normalised text if so.
 *
 * Order is deliberate: identity and sanction first, then the message itself,
 * then the timing limits. A muted account learns that it is muted, rather
 * than being told its message is too long.
 */
export function checkChatPermission(text: string, ctx: ChatContext): ChatPermission {
  if (!ctx.chatEnabled) return deny('chat_disabled')
  if (!ctx.authenticated) return deny('not_authenticated')
  if (ctx.sanctioned) return deny('sanctioned')

  const normalized = normalizeMessage(text)
  if (normalized.length === 0) return deny('empty')
  if (normalized.length > MAX_MESSAGE_LENGTH) return deny('too_long')

  // Repeating yourself verbatim is the cheapest form of flooding, and it
  // survives a rate limit that only counts messages.
  if (ctx.lastText !== null && normalizeMessage(ctx.lastText) === normalized) {
    return deny('duplicate')
  }

  const last = ctx.recentTimestamps[0]
  if (ctx.slowModeMs > 0 && last !== undefined) {
    const elapsed = ctx.now - last
    if (elapsed < ctx.slowModeMs) return deny('slow_mode', ctx.slowModeMs - elapsed)
  }

  const inWindow = ctx.recentTimestamps.filter((t) => ctx.now - t < RATE_WINDOW_MS)
  if (inWindow.length >= MAX_MESSAGES_PER_WINDOW) {
    const oldest = inWindow[inWindow.length - 1]
    return deny('rate_limited', RATE_WINDOW_MS - (ctx.now - oldest))
  }

  return { allowed: true, text: normalized }
}

const DENY_COPY: Record<ChatDenyReason, string> = {
  not_authenticated: 'Connect a wallet to chat. Reading chat needs no account.',
  sanctioned: 'You cannot post in chat right now. Contact support to appeal.',
  chat_disabled: 'Chat is off for this channel.',
  slow_mode: 'Slow mode is on. Wait a moment before posting again.',
  rate_limited: 'You are posting too quickly. Wait a moment.',
  duplicate: 'That is the same as your last message.',
  empty: 'Type something first.',
  too_long: `Messages are limited to ${MAX_MESSAGE_LENGTH} characters.`,
}

/**
 * The HTTP status a refusal deserves.
 *
 * Every refusal used to answer 429 except an unauthenticated one, and that is
 * wrong in a way clients act on: 429 means "you asked too often, try again",
 * so a retry layer — or a well-behaved bot — will send the identical request
 * back. Retrying an empty message, an over-long one, or a post to a channel
 * you are sanctioned on can never succeed, and telling the caller to try again
 * is both a lie and a source of load.
 *
 * Only the two genuine rate conditions keep 429.
 */
export function chatDenyStatus(reason: ChatDenyReason): number {
  switch (reason) {
    case 'not_authenticated':
      return 401
    case 'sanctioned':
    case 'chat_disabled':
      return 403
    case 'empty':
    case 'too_long':
      return 400
    case 'duplicate':
      return 409
    case 'slow_mode':
    case 'rate_limited':
      return 429
  }
}

export function chatDenyMessage(reason: ChatDenyReason): string {
  return DENY_COPY[reason]
}

function deny(reason: ChatDenyReason, retryAfterMs?: number): ChatPermission {
  return { allowed: false, reason, retryAfterMs }
}

// A wallet-shortening helper used to live here. It is gone deliberately:
// public surfaces render `displayName(username)` from lib/identity/username,
// and keeping a tested function that formats an address for display is an
// invitation to reintroduce the leak that removing it closed.
