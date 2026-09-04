import { createHmac } from 'node:crypto'
import { getSecret } from '@/lib/secrets'

/**
 * IP handling for identity and bans.
 *
 * Two deliberate choices here:
 *
 * 1. Raw addresses are never persisted. Everything downstream works on a
 *    peppered HMAC, which still supports exact-match ban lookups but means a
 *    database leak does not hand over a list of players' addresses.
 *
 * 2. Bans are computed at two granularities — the exact address and a prefix
 *    (/24 for IPv4, /64 for IPv6). The prefix exists so a ban can survive a
 *    trivial address rotation, but it is blunt: carrier-grade NAT puts
 *    thousands of unrelated mobile users behind one IPv4 address. Prefix bans
 *    should be short-lived and used as a rate-limiting signal, never as the
 *    only thing standing between an attacker and the site.
 */

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

export function parseIpv4(ip: string): number[] | null {
  const m = IPV4_RE.exec(ip)
  if (!m) return null
  const parts: number[] = []
  for (let i = 1; i <= 4; i++) {
    const raw = m[i]
    // Reject leading zeros: "010.1.1.1" is read as octal by some resolvers,
    // so two spellings of one address must not produce two different hashes.
    if (raw.length > 1 && raw.startsWith('0')) return null
    const n = Number(raw)
    if (n > 255) return null
    parts.push(n)
  }
  return parts
}

function groupsFrom(part: string): number[] | null {
  if (part === '') return []
  const out: number[] = []
  for (const g of part.split(':')) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null
    out.push(parseInt(g, 16))
  }
  return out
}

/** Returns the eight 16-bit groups of an IPv6 address, or null. */
export function parseIpv6(input: string): number[] | null {
  let s = input
  const pct = s.indexOf('%') // strip zone id
  if (pct !== -1) s = s.slice(0, pct)
  if (!s.includes(':')) return null

  // Rewrite a trailing embedded IPv4 ("::ffff:1.2.3.4") into two hex groups
  // so the rest of the parser only ever sees hex.
  const dot = s.indexOf('.')
  if (dot !== -1) {
    const lastColon = s.lastIndexOf(':', dot)
    if (lastColon === -1) return null
    const v4 = parseIpv4(s.slice(lastColon + 1))
    if (!v4) return null
    const hex =
      (((v4[0] << 8) | v4[1]) >>> 0).toString(16) +
      ':' +
      (((v4[2] << 8) | v4[3]) >>> 0).toString(16)
    s = s.slice(0, lastColon + 1) + hex
  }

  const dbl = s.indexOf('::')
  if (dbl !== -1) {
    if (s.indexOf('::', dbl + 1) !== -1) return null // only one '::' allowed
    const head = groupsFrom(s.slice(0, dbl))
    const tail = groupsFrom(s.slice(dbl + 2))
    if (!head || !tail) return null
    const fill = 8 - head.length - tail.length
    if (fill < 1) return null
    return [...head, ...new Array<number>(fill).fill(0), ...tail]
  }

  const all = groupsFrom(s)
  return all && all.length === 8 ? all : null
}

export type NormalizedIp = {
  /** Canonical, fully expanded. Stable input for hashing. */
  canonical: string
  /** Network prefix used for the coarse ban check. */
  prefix: string
  /** Truncated form safe to show an operator in a ban record. */
  display: string
  version: 4 | 6
}

/**
 * Canonicalises an address so that every spelling of it hashes identically.
 * IPv4-mapped IPv6 ("::ffff:203.0.113.5") collapses to its IPv4 form, because
 * the same client reaches us both ways depending on the network path.
 */
export function normalizeIp(input: string): NormalizedIp | null {
  const trimmed = input.trim().replace(/^\[|\]$/g, '')
  if (!trimmed) return null

  const v4 = parseIpv4(trimmed)
  if (v4) {
    return {
      canonical: v4.join('.'),
      prefix: `${v4[0]}.${v4[1]}.${v4[2]}.0/24`,
      display: `${v4[0]}.${v4[1]}.${v4[2]}.x`,
      version: 4,
    }
  }

  const g = parseIpv6(trimmed)
  if (!g) return null

  // ::ffff:a.b.c.d — treat as the IPv4 address it actually is.
  const isV4Mapped =
    g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff
  if (isV4Mapped) {
    const b = [g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff]
    return normalizeIp(b.join('.'))
  }

  const hex = g.map((n) => n.toString(16).padStart(4, '0'))
  return {
    canonical: hex.join(':'),
    prefix: `${hex.slice(0, 4).join(':')}::/64`,
    display: `${hex.slice(0, 4).join(':')}::/64`,
    version: 6,
  }
}

/**
 * Extracts the client address from request headers.
 *
 * Order matters. `x-forwarded-for` is a client-supplied header everywhere
 * except behind a proxy that overwrites it, so the leftmost entry is attacker
 * controlled and must never be trusted — an attacker would otherwise pick
 * their own "IP" per request and walk straight through any IP ban. Vercel's
 * `x-vercel-forwarded-for` is set by the edge and is the value to prefer;
 * `x-real-ip` is the equivalent on most reverse proxies. Falling back to
 * `x-forwarded-for` we take the RIGHTMOST entry, which is the one our own
 * infrastructure appended.
 */
export function clientIpFromHeaders(headers: Headers): string | null {
  const direct = headers.get('x-vercel-forwarded-for') ?? headers.get('x-real-ip')
  if (direct) {
    const norm = normalizeIp(stripPort(direct.trim()))
    if (norm) return norm.canonical
  }

  const xff = headers.get('x-forwarded-for')
  if (xff) {
    const parts = xff.split(',').map((p) => p.trim()).filter(Boolean)
    for (let i = parts.length - 1; i >= 0; i--) {
      const norm = normalizeIp(stripPort(parts[i]))
      if (norm) return norm.canonical
    }
  }
  return null
}

/** Removes a ":port" suffix from IPv4 / bracketed IPv6, leaving bare IPv6 alone. */
export function stripPort(value: string): string {
  if (value.startsWith('[')) {
    const close = value.indexOf(']')
    if (close !== -1) return value.slice(1, close)
    return value
  }
  const colons = value.split(':').length - 1
  if (colons === 1) return value.slice(0, value.lastIndexOf(':'))
  return value
}

/**
 * Async because the pepper may have to be read from storage the first time.
 * Rotating it invalidates every stored IP hash and therefore every network
 * sanction keyed on one.
 */
export async function hashIp(canonical: string): Promise<string> {
  const pepper = await getSecret('IP_HASH_PEPPER')
  return createHmac('sha256', pepper).update(`ip:${canonical}`).digest('hex')
}

export async function hashIpPrefix(prefix: string): Promise<string> {
  const pepper = await getSecret('IP_HASH_PEPPER')
  return createHmac('sha256', pepper).update(`ipprefix:${prefix}`).digest('hex')
}
