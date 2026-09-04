import { describe, expect, it } from 'vitest'
import { checkEmbedUrl } from '@/lib/streams/embed'

const HOSTS = ['player.twitch.tv', 'youtube.com']

describe('checkEmbedUrl', () => {
  it('allows an exact allow-listed host over https', () => {
    expect(checkEmbedUrl('https://player.twitch.tv/?channel=ccg', HOSTS)).toEqual({
      allowed: true,
      url: 'https://player.twitch.tv/?channel=ccg',
    })
  })

  it('allows a genuine subdomain', () => {
    expect(checkEmbedUrl('https://www.youtube.com/embed/abc', HOSTS).allowed).toBe(true)
  })

  it('rejects a lookalike host that merely ends with an allowed one', () => {
    // The reason the subdomain check tests for the dot: "evil-youtube.com"
    // ends with "youtube.com" as a string, and a naive endsWith would frame it.
    expect(checkEmbedUrl('https://evil-youtube.com/embed/abc', HOSTS)).toEqual({
      allowed: false,
      reason: 'host_not_allowed',
    })
  })

  it('rejects a host that only contains an allowed one', () => {
    expect(checkEmbedUrl('https://youtube.com.attacker.net/x', HOSTS).allowed).toBe(false)
  })

  it('rejects plain http', () => {
    expect(checkEmbedUrl('http://youtube.com/embed/abc', HOSTS)).toEqual({
      allowed: false,
      reason: 'not_https',
    })
  })

  it('rejects credentials embedded in the URL', () => {
    expect(checkEmbedUrl('https://user:pw@youtube.com/embed/abc', HOSTS)).toEqual({
      allowed: false,
      reason: 'credentials_in_url',
    })
  })

  it('rejects a malformed URL without throwing', () => {
    expect(checkEmbedUrl('not a url', HOSTS)).toEqual({ allowed: false, reason: 'malformed_url' })
  })

  it('refuses everything when no allow-list is configured', () => {
    // Fail closed: an unset environment variable must not mean "allow all".
    expect(checkEmbedUrl('https://youtube.com/embed/abc', [])).toEqual({
      allowed: false,
      reason: 'no_allowlist_configured',
    })
  })

  it('is case-insensitive on the host', () => {
    expect(checkEmbedUrl('https://YouTube.COM/embed/abc', HOSTS).allowed).toBe(true)
  })
})
