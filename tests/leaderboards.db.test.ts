import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { readBoard } from '@/lib/leaderboards/board'

/**
 * The leaderboard query, against a real database.
 *
 * `rankResults` is pure and covered separately, but the rules that actually
 * decide a board — one row per player on their best result, banned wallets
 * excluded, and no address in the projection — live in SQL and had no coverage
 * at all. They cannot be reached through the UI either, because no game in the
 * catalogue is ranked yet, so this is the only place they are exercised.
 *
 * Skipped when no database is configured, so `npm test` still runs anywhere.
 */
const HAS_DB = Boolean(process.env.DATABASE_URL)
const GAME = 'test-board-game'
const WALLETS = ['TB_best', 'TB_tie_a', 'TB_tie_b', 'TB_banned', 'TB_noname']

describe.skipIf(!HAS_DB)('readBoard', () => {
  beforeAll(async () => {
    const sql = db()
    await cleanup()
    await sql`
      INSERT INTO wallets (address, username) VALUES
        ('TB_best','BoardBest'), ('TB_tie_a','BoardTieA'), ('TB_tie_b','BoardTieB'),
        ('TB_banned','BoardBanned'), ('TB_noname', NULL)
    `
    const rows: Array<[string, string, number, string]> = [
      ['bbbbbbbb-0000-0000-0000-000000000001', 'TB_best', 120, '2 hours'],
      ['bbbbbbbb-0000-0000-0000-000000000002', 'TB_best', 900, '1 hour'],
      ['bbbbbbbb-0000-0000-0000-000000000003', 'TB_tie_a', 500, '40 minutes'],
      ['bbbbbbbb-0000-0000-0000-000000000004', 'TB_tie_b', 500, '20 minutes'],
      ['bbbbbbbb-0000-0000-0000-000000000005', 'TB_banned', 9999, '10 minutes'],
      ['bbbbbbbb-0000-0000-0000-000000000006', 'TB_noname', 50, '5 minutes'],
    ]
    for (const [id, wallet, score, ago] of rows) {
      await sql`
        INSERT INTO play_sessions (id, wallet, game_slug, seed, status)
        VALUES (${id}::uuid, ${wallet}, ${GAME}, 'seed', 'submitted')
      `
      await sql`
        INSERT INTO scores (play_session_id, wallet, game_slug, score, duration_ms, created_at)
        VALUES (${id}::uuid, ${wallet}, ${GAME}, ${score}, 1000, now() - (${ago})::interval)
      `
    }
    await sql`
      INSERT INTO bans (subject_type, subject_key, reason, created_by)
      VALUES ('wallet', 'TB_banned', 'test fixture', 'test')
    `
  })

  afterAll(cleanup)

  it('gives a player one place, on their best result', async () => {
    const board = await readBoard(GAME, 'higher')
    const mine = board.entries.filter((e) => e.name === 'BoardBest')
    expect(mine).toHaveLength(1)
    expect(mine[0].score).toBe(900)
    expect(mine[0].rank).toBe(1)
  })

  it('excludes a banned wallet without deleting its score', async () => {
    const board = await readBoard(GAME, 'higher')
    expect(board.entries.map((e) => e.name)).not.toContain('BoardBanned')

    const kept = (await db()`
      SELECT count(*)::int AS n FROM scores WHERE wallet = 'TB_banned'
    `) as Array<{ n: number }>
    expect(kept[0].n).toBe(1)
  })

  it('shares a place across a tie and skips the next', async () => {
    const board = await readBoard(GAME, 'higher')
    expect(board.entries.map((e) => `${e.rank}:${e.name}`)).toEqual([
      '1:BoardBest',
      '2:BoardTieA',
      '2:BoardTieB',
      '4:Unnamed player',
    ])
  })

  it('reverses the order for a lower-is-better game', async () => {
    const board = await readBoard(GAME, 'lower')
    expect(board.entries[0].name).toBe('Unnamed player')
    expect(board.entries[0].score).toBe(50)
  })

  it('counts only the players it published', async () => {
    const board = await readBoard(GAME, 'higher')
    expect(board.players).toBe(4)
  })

  it('never puts an address in a board entry', async () => {
    const board = await readBoard(GAME, 'higher')
    const serialised = JSON.stringify(board)
    for (const wallet of WALLETS) expect(serialised).not.toContain(wallet)
  })

  it('honours the limit', async () => {
    const board = await readBoard(GAME, 'higher', 2)
    expect(board.entries).toHaveLength(2)
  })
})

async function cleanup() {
  if (!HAS_DB) return
  const sql = db()
  await sql`DELETE FROM scores WHERE game_slug = ${GAME}`
  await sql`DELETE FROM play_sessions WHERE game_slug = ${GAME}`
  await sql`DELETE FROM bans WHERE created_by = 'test'`
  await sql`DELETE FROM wallets WHERE address = ANY(${WALLETS})`
}
