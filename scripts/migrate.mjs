#!/usr/bin/env node
/**
 * Applies every migration in db/ in filename order, once each.
 *
 * Applied migrations are recorded in `schema_migrations`, so re-running is a
 * no-op rather than an error. Each file runs inside a transaction: a migration
 * that fails half way leaves the database on the previous version instead of
 * in a state that is neither.
 *
 *   node scripts/migrate.mjs            apply pending migrations
 *   node scripts/migrate.mjs --status   list what is applied and what is not
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { findDatabaseUrl, MISSING_DATABASE_URL } from '../lib/db-url.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const dbDir = path.join(here, '..', 'db')

const url = findDatabaseUrl()
if (!url) {
  console.error(
    `${MISSING_DATABASE_URL}\n\n` +
      'Or export it for a single run:\n' +
      '  DATABASE_URL=postgres://user:pass@host/db npm run db:migrate',
  )
  process.exit(1)
}

const sql = postgres(url, {
  max: 1,
  onnotice: () => {},
  ssl: url.includes('sslmode=require') ? 'require' : undefined,
})

const files = readdirSync(dbDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()

try {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `

  const applied = new Set(
    (await sql`SELECT filename FROM schema_migrations`).map((r) => r.filename),
  )

  if (process.argv.includes('--status')) {
    for (const f of files) console.log(`${applied.has(f) ? 'applied' : 'PENDING'}  ${f}`)
    await sql.end()
    process.exit(0)
  }

  const pending = files.filter((f) => !applied.has(f))
  if (pending.length === 0) {
    console.log(`Up to date — ${files.length} migration${files.length === 1 ? '' : 's'} applied.`)
    await sql.end()
    process.exit(0)
  }

  for (const file of pending) {
    const body = readFileSync(path.join(dbDir, file), 'utf8')
    process.stdout.write(`applying ${file} … `)
    // `sql.begin` rolls back on throw, so a partially-applied file cannot be
    // recorded as done.
    await sql.begin(async (tx) => {
      await tx.unsafe(body)
      await tx`INSERT INTO schema_migrations (filename) VALUES (${file})`
    })
    console.log('ok')
  }

  console.log(`\nApplied ${pending.length} migration${pending.length === 1 ? '' : 's'}.`)
  await sql.end()
} catch (err) {
  console.error('\nMigration failed:', err instanceof Error ? err.message : err)
  await sql.end({ timeout: 1 }).catch(() => {})
  process.exit(1)
}
