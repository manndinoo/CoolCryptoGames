import { neon } from '@neondatabase/serverless'

let cached: ReturnType<typeof neon> | null = null

/**
 * Postgres over HTTP, which suits serverless — no pool to exhaust when Vercel
 * runs many concurrent instances of a route.
 */
export function db() {
  if (!cached) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is not set')
    cached = neon(url)
  }
  return cached
}
