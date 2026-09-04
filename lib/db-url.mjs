/**
 * Finds the Postgres connection string, whatever the host decided to call it.
 *
 * Managed Postgres integrations each name their variables differently, and
 * Vercel's marketplace installer can additionally prepend a prefix chosen at
 * install time. A mismatch produces exactly the symptom a missing database
 * does — every authenticated route failing — so it is worth accepting the
 * handful of names these providers actually use rather than making the
 * deployment match one hard-coded string.
 *
 * Ordering matters. A pooled URL is preferred over a direct one: each
 * serverless instance opens its own connections, and the direct endpoint runs
 * out of slots under load in a way that looks like random failures.
 */

/** Checked in order; the first one set wins. */
const CANDIDATES = [
  'DATABASE_URL',
  'POSTGRES_URL',
  'POSTGRES_PRISMA_URL',
  'DATABASE_POSTGRES_URL',
  'STORAGE_DATABASE_URL',
  'STORAGE_POSTGRES_URL',
  // Unpooled forms come last: usable, but not what a serverless deployment
  // should be reaching for.
  'DATABASE_URL_UNPOOLED',
  'POSTGRES_URL_NON_POOLING',
]

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {string | null}
 */
export function findDatabaseUrl(env = process.env) {
  for (const name of CANDIDATES) {
    const value = env[name]
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }

  // Last resort: any *_DATABASE_URL or *_POSTGRES_URL the installer created
  // under a custom prefix. Sorted so the choice is deterministic rather than
  // dependent on environment ordering.
  const suffixed = Object.keys(env)
    .filter((k) => /(^|_)(DATABASE|POSTGRES)_URL$/.test(k) && !k.includes('UNPOOLED'))
    .sort()

  for (const name of suffixed) {
    const value = env[name]
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return null
}

/** Message shown when nothing is configured. Names what to do, not just what failed. */
export const MISSING_DATABASE_URL =
  'No Postgres connection string found. Set DATABASE_URL (or POSTGRES_URL) to the ' +
  'pooled connection string from your database provider, then run: npm run db:migrate'
