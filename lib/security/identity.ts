import { db } from '@/lib/db'
import { clientIpFromHeaders, hashIp, hashIpPrefix, normalizeIp } from './ip'
import { hashFingerprint, normalizeComponents } from './fingerprint'
import { findActiveBan, type ActiveBan } from './bans'

export type ResolvedIdentity = {
  deviceId: string | null
  ipHash: string | null
  ipPrefixHash: string | null
  ipDisplay: string | null
}

/**
 * Turns a request plus its client-supplied fingerprint into stored identity
 * rows, and returns the keys the ban check needs.
 *
 * Note that a missing or malformed fingerprint is not treated as an error —
 * that would let anyone opt out of device tracking by sending nothing. It
 * resolves to a null deviceId, and the policy for what to do about that lives
 * in the route (currently: refuse to start a run).
 */
export async function resolveIdentity(args: {
  headers: Headers
  fingerprint: unknown
}): Promise<ResolvedIdentity> {
  const sql = db()

  let deviceId: string | null = null
  const components = normalizeComponents(args.fingerprint)
  if (components) {
    const fp = hashFingerprint(components)
    const rows = (await sql`
      INSERT INTO devices (fingerprint_hash)
      VALUES (${fp})
      ON CONFLICT (fingerprint_hash)
        DO UPDATE SET last_seen = now()
      RETURNING id
    `) as Array<{ id: string }>
    deviceId = rows[0]?.id ?? null
  }

  let ipHash: string | null = null
  let ipPrefixHash: string | null = null
  let ipDisplay: string | null = null

  const raw = clientIpFromHeaders(args.headers)
  const norm = raw ? normalizeIp(raw) : null
  if (norm) {
    ipHash = hashIp(norm.canonical)
    ipPrefixHash = hashIpPrefix(norm.prefix)
    ipDisplay = norm.display
    await sql`
      INSERT INTO ip_records (ip_hash, prefix_hash, ip_display)
      VALUES (${ipHash}, ${ipPrefixHash}, ${ipDisplay})
      ON CONFLICT (ip_hash) DO UPDATE SET last_seen = now()
    `
  }

  return { deviceId, ipHash, ipPrefixHash, ipDisplay }
}

/** Records that this wallet was seen on this device and address. */
export async function linkIdentity(args: {
  wallet: string
  deviceId: string | null
  ipHash: string | null
}): Promise<void> {
  if (!args.deviceId || !args.ipHash) return
  const sql = db()
  await sql`
    INSERT INTO identity_links (wallet, device_id, ip_hash)
    VALUES (${args.wallet}, ${args.deviceId}::uuid, ${args.ipHash})
    ON CONFLICT (wallet, device_id, ip_hash)
      DO UPDATE SET last_seen = now(), hits = identity_links.hits + 1
  `
}

export async function banFor(
  identity: ResolvedIdentity,
  wallet?: string | null,
): Promise<ActiveBan | null> {
  return findActiveBan({
    wallet,
    deviceId: identity.deviceId,
    ipHash: identity.ipHash,
    ipPrefixHash: identity.ipPrefixHash,
  })
}
