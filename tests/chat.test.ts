import { describe, expect, it } from 'vitest'
import {
  chatHandle,
  checkChatPermission,
  MAX_MESSAGE_LENGTH,
  normalizeMessage,
  type ChatContext,
} from '@/lib/chat/rules'

const NOW = 1_000_000

/** Built from code points so this file stays free of literal control bytes. */
const NUL = String.fromCharCode(0x00)
const ZWSP = String.fromCharCode(0x200b)
const ZWNJ = String.fromCharCode(0x200c)
const ELLIPSIS = String.fromCharCode(0x2026)

function ctx(over: Partial<ChatContext> = {}): ChatContext {
  return {
    authenticated: true,
    sanctioned: false,
    chatEnabled: true,
    slowModeMs: 0,
    recentTimestamps: [],
    lastText: null,
    now: NOW,
    ...over,
  }
}

describe('normalizeMessage', () => {
  it('collapses whitespace and trims', () => {
    expect(normalizeMessage('  hello   there  ')).toBe('hello there')
  })

  it('turns newlines into spaces rather than deleting them', () => {
    // Stripping them outright would fuse two words into one.
    expect(normalizeMessage('good\nrun')).toBe('good run')
  })

  it('strips control characters', () => {
    expect(normalizeMessage(`he${NUL}llo`)).toBe('hello')
  })

  it('strips zero-width characters', () => {
    // Zero-width joiners are how an identical-looking message slips past a
    // duplicate check.
    expect(normalizeMessage(`spam${ZWSP}${ZWNJ}spam`)).toBe('spamspam')
  })

  it('keeps ordinary punctuation and emoji', () => {
    expect(normalizeMessage('gg! ')).toBe('gg!')
  })
})

describe('checkChatPermission', () => {
  it('allows a normal message and returns normalised text', () => {
    expect(checkChatPermission('  nice run  ', ctx())).toEqual({
      allowed: true,
      text: 'nice run',
    })
  })

  it('requires a wallet to post', () => {
    // Reading is open to everyone; posting is attributed.
    expect(checkChatPermission('hi', ctx({ authenticated: false }))).toMatchObject({
      allowed: false,
      reason: 'not_authenticated',
    })
  })

  it('refuses a sanctioned account before validating the message', () => {
    // A muted account should learn it is muted, not that its message is long.
    expect(checkChatPermission('x'.repeat(9999), ctx({ sanctioned: true }))).toMatchObject({
      allowed: false,
      reason: 'sanctioned',
    })
  })

  it('refuses when chat is off for the channel', () => {
    expect(checkChatPermission('hi', ctx({ chatEnabled: false }))).toMatchObject({
      allowed: false,
      reason: 'chat_disabled',
    })
  })

  it('rejects an empty or whitespace-only message', () => {
    expect(checkChatPermission('   ', ctx())).toMatchObject({ allowed: false, reason: 'empty' })
  })

  it('rejects a message that is only control characters', () => {
    expect(checkChatPermission(NUL + NUL, ctx())).toMatchObject({
      allowed: false,
      reason: 'empty',
    })
  })

  it('rejects an over-long message', () => {
    expect(checkChatPermission('x'.repeat(MAX_MESSAGE_LENGTH + 1), ctx())).toMatchObject({
      allowed: false,
      reason: 'too_long',
    })
  })

  it('accepts a message exactly at the limit', () => {
    expect(checkChatPermission('x'.repeat(MAX_MESSAGE_LENGTH), ctx()).allowed).toBe(true)
  })

  it('rejects a verbatim repeat of the last message', () => {
    expect(checkChatPermission('gg', ctx({ lastText: 'gg' }))).toMatchObject({
      allowed: false,
      reason: 'duplicate',
    })
  })

  it('treats a repeat padded with zero-width characters as a duplicate', () => {
    expect(checkChatPermission(`g${ZWSP}g`, ctx({ lastText: 'gg' }))).toMatchObject({
      allowed: false,
      reason: 'duplicate',
    })
  })

  it('enforces slow mode with a retry hint', () => {
    const res = checkChatPermission('hi', ctx({ slowModeMs: 5_000, recentTimestamps: [NOW - 2_000] }))
    expect(res).toMatchObject({ allowed: false, reason: 'slow_mode' })
    if (!res.allowed) expect(res.retryAfterMs).toBe(3_000)
  })

  it('allows the message once slow mode has elapsed', () => {
    expect(
      checkChatPermission('hi', ctx({ slowModeMs: 5_000, recentTimestamps: [NOW - 6_000] })).allowed,
    ).toBe(true)
  })

  it('rate limits a burst inside the window', () => {
    const recent = Array.from({ length: 8 }, (_, i) => NOW - i * 1_000)
    expect(checkChatPermission('hi', ctx({ recentTimestamps: recent }))).toMatchObject({
      allowed: false,
      reason: 'rate_limited',
    })
  })

  it('ignores messages that have aged out of the window', () => {
    const recent = Array.from({ length: 8 }, (_, i) => NOW - 40_000 - i * 1_000)
    expect(checkChatPermission('hi', ctx({ recentTimestamps: recent })).allowed).toBe(true)
  })

  it('allows a message just under the burst limit', () => {
    const recent = Array.from({ length: 7 }, (_, i) => NOW - i * 1_000)
    expect(checkChatPermission('hi', ctx({ recentTimestamps: recent })).allowed).toBe(true)
  })
})

describe('chatHandle', () => {
  it('shortens a wallet for display', () => {
    expect(chatHandle('DemoWa11et1111111111111111111111111111111111')).toBe(
      `Demo${ELLIPSIS}1111`,
    )
  })
})
