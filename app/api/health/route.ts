import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { findDatabaseUrl } from '@/lib/db-url.mjs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Setup status, safe to open in a browser.
 *
 * Exists because the only way to tell whether a deployment was configured
 * correctly was to try signing in and interpret the failure. This answers the
 * question directly.
 *
 * Deliberately says nothing that would help an attacker: no connection string,
 * no host, no error text, no version numbers. Whether a database is reachable
 * and how many migrations have run is not sensitive, and being able to check it
 * without a terminal is worth more than the obscurity of hiding it.
 */
export async function GET() {
  const configured = findDatabaseUrl() !== null

  if (!configured) {
    return NextResponse.json(
      {
        ready: false,
        database: 'not_configured',
        message:
          'No database is connected yet. Add a Postgres integration to this project and redeploy.',
      },
      { status: 503 },
    )
  }

  try {
    const sql = db()

    const migrations = (await sql`
      SELECT count(*)::int AS n FROM schema_migrations
    `) as Array<{ n: number }>

    // Whether the platform has settled on its signing key and peppers yet. They
    // are created on first use, so an empty table simply means nobody has
    // signed in since the database was connected.
    const secrets = (await sql`
      SELECT count(*)::int AS n FROM platform_secrets
    `) as Array<{ n: number }>

    return NextResponse.json({
      ready: true,
      database: 'connected',
      migrationsApplied: migrations[0]?.n ?? 0,
      secretsEstablished: secrets[0]?.n ?? 0,
      message: 'Ready. Connect a wallet and sign in.',
    })
  } catch {
    // The reason is in the server log. A public endpoint saying which host
    // refused a connection would be telling on itself.
    return NextResponse.json(
      {
        ready: false,
        database: 'unreachable',
        message:
          'A database is configured but could not be reached. Check the connection string, and prefer the pooled one.',
      },
      { status: 503 },
    )
  }
}
