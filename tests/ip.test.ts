import { describe, expect, it } from 'vitest'
import {
  clientIpFromHeaders,
  normalizeIp,
  parseIpv4,
  parseIpv6,
  stripPort,
} from '@/lib/security/ip'

describe('parseIpv4', () => {
  it('parses a dotted quad', () => {
    expect(parseIpv4('203.0.113.5')).toEqual([203, 0, 113, 5])
  })

  it('rejects out-of-range octets', () => {
    expect(parseIpv4('203.0.113.256')).toBeNull()
  })

  it('rejects leading zeros so one address has one spelling', () => {
    // "010.0.113.5" is octal to some resolvers; two spellings must not become
    // two different hashes and therefore two different ban identities.
    expect(parseIpv4('010.0.113.5')).toBeNull()
  })
})

describe('parseIpv6', () => {
  it('expands a compressed address', () => {
    expect(parseIpv6('2001:db8::1')).toEqual([0x2001, 0xdb8, 0, 0, 0, 0, 0, 1])
  })

  it('handles the all-zeros address', () => {
    expect(parseIpv6('::')).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
  })

  it('parses an embedded IPv4 tail', () => {
    expect(parseIpv6('::ffff:203.0.113.5')).toEqual([
      0, 0, 0, 0, 0, 0xffff, 0xcb00, 0x7105,
    ])
  })

  it('rejects two "::" runs, which are ambiguous', () => {
    expect(parseIpv6('2001::db8::1')).toBeNull()
  })

  it('strips a zone id', () => {
    expect(parseIpv6('fe80::1%eth0')).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 1])
  })
})

describe('normalizeIp', () => {
  it('gives IPv4 a /24 prefix and a truncated display form', () => {
    const n = normalizeIp('203.0.113.5')
    expect(n).toMatchObject({
      canonical: '203.0.113.5',
      prefix: '203.0.113.0/24',
      display: '203.0.113.x',
      version: 4,
    })
  })

  it('collapses IPv4-mapped IPv6 to plain IPv4', () => {
    // The same client can arrive either way depending on network path; both
    // must hash to one identity or a ban is trivially sidestepped.
    expect(normalizeIp('::ffff:203.0.113.5')?.canonical).toBe('203.0.113.5')
    expect(normalizeIp('::ffff:203.0.113.5')?.version).toBe(4)
  })

  it('canonicalises every spelling of one IPv6 address identically', () => {
    const a = normalizeIp('2001:DB8:0:0:0:0:0:1')
    const b = normalizeIp('2001:db8::1')
    expect(a?.canonical).toBe(b?.canonical)
    expect(a?.prefix).toBe('2001:0db8:0000:0000::/64')
  })

  it('unwraps bracketed IPv6', () => {
    expect(normalizeIp('[2001:db8::1]')?.canonical).toBe(
      normalizeIp('2001:db8::1')?.canonical,
    )
  })

  it('rejects junk', () => {
    expect(normalizeIp('not-an-ip')).toBeNull()
    expect(normalizeIp('')).toBeNull()
  })
})

describe('stripPort', () => {
  it('removes a port from IPv4', () => {
    expect(stripPort('203.0.113.5:443')).toBe('203.0.113.5')
  })

  it('leaves a bare IPv6 address alone', () => {
    expect(stripPort('2001:db8::1')).toBe('2001:db8::1')
  })

  it('unwraps bracketed IPv6 with a port', () => {
    expect(stripPort('[2001:db8::1]:443')).toBe('2001:db8::1')
  })
})

describe('clientIpFromHeaders', () => {
  it('prefers the edge-set header over x-forwarded-for', () => {
    const h = new Headers({
      'x-vercel-forwarded-for': '203.0.113.5',
      'x-forwarded-for': '1.2.3.4',
    })
    expect(clientIpFromHeaders(h)).toBe('203.0.113.5')
  })

  it('takes the RIGHTMOST x-forwarded-for entry', () => {
    // The leftmost entry is whatever the client typed. Trusting it would let
    // an attacker pick a fresh "IP" per request and walk through any IP ban.
    const h = new Headers({ 'x-forwarded-for': '9.9.9.9, 8.8.8.8, 203.0.113.5' })
    expect(clientIpFromHeaders(h)).toBe('203.0.113.5')
  })

  it('skips unparseable trailing entries', () => {
    const h = new Headers({ 'x-forwarded-for': '203.0.113.5, garbage' })
    expect(clientIpFromHeaders(h)).toBe('203.0.113.5')
  })

  it('returns null when no header carries an address', () => {
    expect(clientIpFromHeaders(new Headers())).toBeNull()
  })
})
