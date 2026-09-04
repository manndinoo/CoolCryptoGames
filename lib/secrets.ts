import { randomBytes } from 'node:crypto'
import { db } from './db'

/**
 * Resolves the signing keys and hash peppers the platform needs.
 *
 * Order: the environment variable if it is set, otherwise a value stored in the
 * database, generated on first use if it is not there yet.
 *
 * The point of the fallback is that connecting a database is the only setup
 * step. Requiring someone to generate three random strings and paste them into
 * a hosting dashboard before anything works is friction that produces exactly
 * one outcome when it goes wrong — a sign-in button that does nothing.
 *
 * Environment variables still win wherever they are set, so a deployment that
 * wants these kept out of the database simply sets them and this file never
 * reads a row. That is the stronger configuration and is worth moving to.
 */

export type SecretName = 'SESSION_SECRET' | 'IP_HASH_PEPPER' | 'FINGERPRINT_PEPPER'

const MIN_LENGTH = 32

/**
 * Cached for the life of the instance. These change only when someone rotates
 * them deliberately, and rotation already invalidates everything derived from
 * the old value, so a restart is the expected way to pick up a new one.
 */
const cache = new Map<SecretName, string>()

export async function getSecret(name: SecretName): Promise<string> {
  const cached = cache.get(name)
  if (cached) return cached

  const fromEnv = process.env[name]
  if (typeof fromEnv === 'string' && fromEnv.length >= MIN_LENGTH) {
    cache.set(name, fromEnv)
    return fromEnv
  }

  if (typeof fromEnv === 'string' && fromEnv.length > 0) {
    // Set but too short. Falling back to a generated value would mean a
    // deployment silently ignoring the operator's configuration.
    throw new Error(`${name} is set but shorter than ${MIN_LENGTH} characters`)
  }

  const value = await loadOrCreate(name)
  cache.set(name, value)
  return value
}

async function loadOrCreate(name: SecretName): Promise<string> {
  const sql = db()

  const existing = (await sql`
    SELECT value FROM platform_secrets WHERE name = ${name}
  `) as Array<{ value: string }>
  if (existing[0]) return existing[0].value

  // Two instances can boot at once and both find nothing. ON CONFLICT DO
  // NOTHING means the loser inserts nothing rather than overwriting the
  // winner's value — which would invalidate every session and hash the winner
  // had already produced.
  const candidate = randomBytes(32).toString('base64url')
  await sql`
    INSERT INTO platform_secrets (name, value)
    VALUES (${name}, ${candidate})
    ON CONFLICT (name) DO NOTHING
  `

  const settled = (await sql`
    SELECT value FROM platform_secrets WHERE name = ${name}
  `) as Array<{ value: string }>

  if (!settled[0]) throw new Error(`Could not establish ${name}`)
  return settled[0].value
}

/** Test seam. Not used in application code. */
export function resetSecretCache(): void {
  cache.clear()
}
