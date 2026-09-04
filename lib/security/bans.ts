import { db } from '@/lib/db'

export type BanSubjectType = 'wallet' | 'device' | 'ip' | 'ip_prefix'

export type ActiveBan = {
  id: string
  subjectType: BanSubjectType
  reason: string
  expiresAt: string | null
}

export type IdentityKeys = {
  wallet?: string | null
  deviceId?: string | null
  ipHash?: string | null
  ipPrefixHash?: string | null
}

/**
 * Returns the first active ban matching any part of the caller's identity.
 *
 * Checked most-specific first, so the reason surfaced to an operator reading
 * logs is the most meaningful one. Wallet and device bans are the ones worth
 * making permanent; IP bans should almost always carry an expiry, because
 * addresses are reassigned and carrier-grade NAT means one IPv4 address can
 * front an entire city's mobile users.
 */
export async function findActiveBan(keys: IdentityKeys): Promise<ActiveBan | null> {
  const pairs: [BanSubjectType, string][] = []
  if (keys.wallet) pairs.push(['wallet', keys.wallet])
  if (keys.deviceId) pairs.push(['device', keys.deviceId])
  if (keys.ipHash) pairs.push(['ip', keys.ipHash])
  if (keys.ipPrefixHash) pairs.push(['ip_prefix', keys.ipPrefixHash])
  if (pairs.length === 0) return null

  const sql = db()
  const types = pairs.map((p) => p[0])
  const values = pairs.map((p) => p[1])

  const rows = (await sql`
    SELECT id, subject_type, subject_key, reason, expires_at
    FROM bans
    WHERE revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > now())
      AND (subject_type::text, subject_key) IN (
        SELECT * FROM unnest(${types}::text[], ${values}::text[])
      )
    ORDER BY array_position(
      ARRAY['wallet','device','ip','ip_prefix']::text[], subject_type::text
    )
    LIMIT 1
  `) as Array<{
    id: string
    subject_type: BanSubjectType
    reason: string
    expires_at: string | null
  }>

  const row = rows[0]
  if (!row) return null
  return {
    id: row.id,
    subjectType: row.subject_type,
    reason: row.reason,
    expiresAt: row.expires_at,
  }
}

/**
 * Every wallet, device and address that has ever shared a session with any of
 * the given identity's members.
 *
 * This is the payoff for recording links: when you catch one cheating wallet,
 * this shows you the rest of the ring, so you ban the operation rather than
 * playing whack-a-mole with the accounts it keeps minting.
 */
export async function relatedIdentities(wallet: string): Promise<{
  wallets: string[]
  devices: string[]
  ips: string[]
}> {
  const sql = db()
  const rows = (await sql`
    WITH seed AS (
      SELECT device_id, ip_hash FROM identity_links WHERE wallet = ${wallet}
    )
    SELECT DISTINCT l.wallet, l.device_id, l.ip_hash
    FROM identity_links l
    JOIN seed s
      ON l.device_id = s.device_id OR l.ip_hash = s.ip_hash
  `) as Array<{ wallet: string; device_id: string; ip_hash: string }>

  return {
    wallets: [...new Set(rows.map((r) => r.wallet))],
    devices: [...new Set(rows.map((r) => r.device_id))],
    ips: [...new Set(rows.map((r) => r.ip_hash))],
  }
}
