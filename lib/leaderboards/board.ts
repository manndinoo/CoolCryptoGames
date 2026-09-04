import { db } from '@/lib/db'
import { displayName } from '@/lib/identity/username'

/**
 * Leaderboards.
 *
 * Two rules decide everything in this file.
 *
 * The first is that a board may only contain results the server produced
 * itself. Rows in `scores` are always the output of a server-side replay — the
 * submit route never writes a client-reported number — so reading that table
 * is what makes a board trustworthy. A game the server cannot replay has no
 * board at all rather than an unverified one.
 *
 * The second is that a board never emits a wallet address. Every query here
 * selects `wallets.username` and nothing else from the identity tables; the
 * address is the credential behind the account and is shown only back to the
 * person who controls it.
 */

export type ScoreDirection = 'higher' | 'lower'

/** One row as stored: a player's best result for a game. */
export type BoardResult = {
  username: string | null
  score: number
  achievedAt: string
}

export type BoardEntry = BoardResult & {
  /** Standard competition ranking: ties share a place, the next place skips. */
  rank: number
  name: string
}

export type Board = {
  gameSlug: string
  direction: ScoreDirection
  entries: BoardEntry[]
  /** Distinct players with at least one verified result. */
  players: number
}

/**
 * Assigns places to results that are already in board order.
 *
 * Ties share a place — two players on the same verified score are level, and
 * separating them by who submitted first would be inventing a distinction the
 * scoring model does not make. The place after a tie skips, so a pair sharing
 * 1st is followed by 3rd. Kept pure so the rule is testable without a database.
 */
export function rankResults(results: BoardResult[], direction: ScoreDirection): BoardEntry[] {
  const ordered = [...results].sort((a, b) => {
    if (a.score !== b.score) {
      return direction === 'lower' ? a.score - b.score : b.score - a.score
    }
    // Display order within a tie only. Both still carry the same rank.
    return Date.parse(a.achievedAt) - Date.parse(b.achievedAt)
  })

  let lastScore: number | null = null
  let lastRank = 0

  return ordered.map((result, index) => {
    const rank = result.score === lastScore ? lastRank : index + 1
    lastScore = result.score
    lastRank = rank
    return { ...result, rank, name: displayName(result.username) }
  })
}

const DEFAULT_LIMIT = 100

/**
 * Reads one game's board.
 *
 * A player appears once, on their best result — a leaderboard that let one
 * person occupy the whole top ten is a list of attempts, not of players.
 *
 * Wallets under an active ban are excluded rather than deleted: the score rows
 * stay for review, they simply stop being published. Only wallet-level bans
 * filter here. Device and network bans stop new play at the point of entry;
 * applying them retroactively to a board would remove results belonging to
 * everyone who ever shared a household or a carrier NAT with the banned party.
 */
export async function readBoard(
  gameSlug: string,
  direction: ScoreDirection,
  limit = DEFAULT_LIMIT,
): Promise<Board> {
  const sql = db()

  // The direction cannot be interpolated — it is part of the query plan, not a
  // value — so the two orderings are written out rather than assembled from a
  // string. Two literal queries are also two things a reader can check.
  const rows = (
    direction === 'lower'
      ? await sql`
          WITH best AS (
            SELECT DISTINCT ON (s.wallet) s.wallet, s.score, s.created_at
            FROM scores s
            WHERE s.game_slug = ${gameSlug}
              AND NOT EXISTS (
                SELECT 1 FROM bans b
                WHERE b.subject_type = 'wallet'
                  AND b.subject_key = s.wallet
                  AND b.revoked_at IS NULL
                  AND (b.expires_at IS NULL OR b.expires_at > now())
              )
            ORDER BY s.wallet, s.score ASC, s.created_at ASC
          )
          SELECT w.username, best.score, best.created_at
          FROM best JOIN wallets w ON w.address = best.wallet
          ORDER BY best.score ASC, best.created_at ASC
          LIMIT ${limit}
        `
      : await sql`
          WITH best AS (
            SELECT DISTINCT ON (s.wallet) s.wallet, s.score, s.created_at
            FROM scores s
            WHERE s.game_slug = ${gameSlug}
              AND NOT EXISTS (
                SELECT 1 FROM bans b
                WHERE b.subject_type = 'wallet'
                  AND b.subject_key = s.wallet
                  AND b.revoked_at IS NULL
                  AND (b.expires_at IS NULL OR b.expires_at > now())
              )
            ORDER BY s.wallet, s.score DESC, s.created_at ASC
          )
          SELECT w.username, best.score, best.created_at
          FROM best JOIN wallets w ON w.address = best.wallet
          ORDER BY best.score DESC, best.created_at ASC
          LIMIT ${limit}
        `
  ) as Array<{ username: string | null; score: string; created_at: Date | string }>

  const results: BoardResult[] = rows.map((row) => ({
    username: row.username,
    // BIGINT arrives as a string; Number() here is safe because the validator
    // caps every score well below 2^53 before it is ever written.
    score: Number(row.score),
    achievedAt: new Date(row.created_at).toISOString(),
  }))

  return {
    gameSlug,
    direction,
    entries: rankResults(results, direction),
    players: results.length,
  }
}

/**
 * Boards for several games at once, for the index page.
 *
 * A single failure — an unreachable database, most likely — is reported by
 * returning null rather than throwing, so the page renders an honest "not
 * available" state instead of a 500 for a surface that is otherwise public.
 */
export async function readBoardsSafely(
  games: { slug: string; direction: ScoreDirection }[],
  limit: number,
): Promise<Map<string, Board> | null> {
  try {
    const boards = await Promise.all(
      games.map((game) => readBoard(game.slug, game.direction, limit)),
    )
    return new Map(boards.map((board) => [board.gameSlug, board]))
  } catch (err) {
    console.error('[ccg] leaderboards unavailable:', err)
    return null
  }
}
