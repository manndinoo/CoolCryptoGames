import postgres from 'postgres'
import { findDatabaseUrl, MISSING_DATABASE_URL } from './db-url.mjs'

/**
 * PostgreSQL access.
 *
 * A plain Postgres driver rather than a vendor-specific serverless one, so the
 * project runs against `docker compose up` with no cloud account, and the
 * hosting choice stays open — the Technical Blueprint requires both a managed
 * Node path and a container path, with no hosting company hard-coded.
 *
 * Domain rules live above this. Nothing outside the repository layer should
 * import it directly.
 */

let cached: postgres.Sql | null = null

export function db(): postgres.Sql {
  if (!cached) {
    const url = findDatabaseUrl()
    if (!url) throw new Error(`DATABASE_URL is not set. ${MISSING_DATABASE_URL}`)
    cached = postgres(url, {
      // Serverless platforms create many short-lived instances; a small pool
      // per instance avoids exhausting Postgres connection slots.
      max: Number(process.env.DATABASE_POOL_MAX ?? 5),
      idle_timeout: 20,
      connect_timeout: 10,
      // Hosted Postgres almost always terminates TLS with its own CA.
      ssl: url.includes('sslmode=require') ? 'require' : undefined,
    })
  }
  return cached
}
