import type { BoardEntry, ScoreDirection } from '@/lib/leaderboards/board'

/**
 * A board's rows.
 *
 * The player column is a username. There is deliberately no address, no
 * truncated address, and no avatar derived from one — a shortened key is still
 * a public link to an on-chain history, which is the thing usernames exist to
 * keep off this page.
 */
export function BoardTable({
  entries,
  unit,
  highlightName,
}: {
  entries: BoardEntry[]
  unit: string
  /** Renders one row as the reader's own, when they are on the board. */
  highlightName?: string | null
}) {
  return (
    <ol className="divide-y divide-[var(--color-subtle-border)]">
      {entries.map((entry) => {
        const mine = highlightName != null && entry.name === highlightName
        return (
          <li
            key={`${entry.rank}-${entry.name}-${entry.achievedAt}`}
            className={`flex items-center gap-4 py-3 ${mine ? 'text-accent' : ''}`}
          >
            <span
              className={`w-8 shrink-0 text-right font-display text-sm font-bold tabular-nums ${
                entry.rank <= 3 && !mine ? 'text-bone' : 'text-[var(--color-muted)]'
              }`}
            >
              {entry.rank}
            </span>
            <span className="min-w-0 flex-1 truncate font-medium">
              {entry.name}
              {mine && (
                <span className="ml-2 text-[10px] font-bold tracking-[var(--tracking-label)] uppercase">
                  You
                </span>
              )}
            </span>
            <span className="shrink-0 font-display font-bold tabular-nums">
              {entry.score.toLocaleString('en-US')}
              {unit && (
                <span className="ml-1 text-xs font-medium text-[var(--color-muted)]">{unit}</span>
              )}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

/**
 * What a board says when it has nothing in it.
 *
 * This is the honest state for a game that is ranked but has not been played
 * yet, and it says so in those words. Seeding it with plausible names and
 * scores would teach a reader that the numbers on this page are decoration.
 */
export function EmptyBoard({ direction }: { direction: ScoreDirection }) {
  return (
    <p className="py-6 text-sm text-[var(--color-muted)]">
      No verified results yet. The first run the server replays and confirms takes
      first place — {direction === 'lower' ? 'lowest' : 'highest'} score leads.
    </p>
  )
}
