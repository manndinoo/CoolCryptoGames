import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { BoardTable, EmptyBoard } from '@/components/leaderboards/board-table'
import { StatusPill, VerifiedBadge } from '@/components/ui/badges'
import { demoGames } from '@/lib/content/demo'
import { readBoardsSafely } from '@/lib/leaderboards/board'
import { gridColumns } from '@/lib/ui/columns'

export const metadata: Metadata = {
  title: 'Leaderboards',
  description:
    'Standings built only from runs the server replayed and confirmed. Free to browse, no wallet needed.',
}

/**
 * Reads live rows, so it cannot be prerendered at build time. Browsing stays
 * open to everyone — a leaderboard nobody can read without connecting a wallet
 * is a leaderboard that persuades nobody.
 */
export const dynamic = 'force-dynamic'

const PREVIEW_ROWS = 5

export default async function LeaderboardsPage() {
  const ranked = demoGames.filter((g) => g.scoreVerification === 'deterministic-replay')
  const unranked = demoGames.filter((g) => g.scoreVerification !== 'deterministic-replay')

  const boards = await readBoardsSafely(
    ranked.map((g) => ({ slug: g.slug, direction: g.scoreDirection })),
    PREVIEW_ROWS,
  )

  return (
    <>
      <header className="pt-[var(--spacing-7)]">
        <h1 className="font-display text-4xl font-black tracking-[var(--tracking-display)] uppercase">
          Leaderboards
        </h1>
        <p className="mt-3 max-w-xl text-[var(--color-muted)]">
          Every place here was earned by a run the server replayed from the player&apos;s
          own inputs and reproduced independently. A score the server cannot reproduce
          does not appear.
        </p>
      </header>

      {boards === null && (
        <p className="mt-[var(--spacing-5)] rounded-[var(--radius-medium)] border border-[var(--color-subtle-border)] bg-[var(--color-graphite)] p-4 text-sm text-[var(--color-muted)]">
          Standings could not be loaded right now. This is a storage problem on our
          side, not a change to anyone&apos;s results — nothing has been recalculated.
        </p>
      )}

      {ranked.length === 0 ? (
        <p className="mt-[var(--spacing-6)] max-w-xl text-[var(--color-muted)]">
          No game in the catalogue has server-side replay yet, so there is nothing here
          to rank. The section below lists what is playable in the meantime.
        </p>
      ) : (
        <div
          className={`ccg-stagger mt-[var(--spacing-6)] grid gap-[var(--spacing-4)] ${gridColumns(ranked.length, 2)}`}
        >
          {ranked.map((game) => {
            const board = boards?.get(game.slug)
            return (
              <section
                key={game.slug}
                className="ccg-surface rounded-[var(--radius-large)] p-[var(--spacing-5)]"
              >
                <div className="flex items-start gap-4">
                  {game.cover && (
                    <div className="relative size-14 shrink-0 overflow-hidden rounded-[var(--radius-medium)] border border-[var(--color-subtle-border)]">
                      <Image
                        src={game.cover}
                        alt=""
                        aria-hidden
                        fill
                        sizes="56px"
                        className="object-cover object-center"
                      />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="mb-1.5 flex flex-wrap items-center gap-2">
                      <VerifiedBadge />
                      <StatusPill>
                        {game.scoreDirection === 'lower' ? 'Lowest wins' : 'Highest wins'}
                      </StatusPill>
                    </div>
                    <h2 className="font-display text-xl font-extrabold tracking-[var(--tracking-display)] uppercase">
                      {game.title}
                    </h2>
                  </div>
                </div>

                <div className="mt-[var(--spacing-4)] border-t border-[var(--color-subtle-border)]">
                  {board && board.entries.length > 0 ? (
                    <BoardTable entries={board.entries} unit={game.scoreUnit} />
                  ) : (
                    <EmptyBoard direction={game.scoreDirection} />
                  )}
                </div>

                <Link
                  href={`/leaderboards/${game.slug}`}
                  className="mt-[var(--spacing-4)] ccg-btn ccg-btn-ghost"
                >
                  Full board
                </Link>
              </section>
            )
          })}
        </div>
      )}

      {unranked.length > 0 && (
        <section className="mt-[var(--spacing-7)]">
          <h2 className="font-display text-[11px] font-bold tracking-[var(--tracking-label)] text-[var(--color-muted)] uppercase">
            Playable, not ranked
          </h2>
          <p className="mt-2 max-w-xl text-sm text-[var(--color-muted)]">
            These games run on the client in a way the server cannot reproduce, so a
            score from them cannot be independently confirmed. They are open to play;
            they just do not carry a board.
          </p>
          <ul className="mt-[var(--spacing-4)] grid gap-px overflow-hidden rounded-[var(--radius-large)] border border-[var(--color-subtle-border)] bg-[var(--color-subtle-border)] sm:grid-cols-2">
            {unranked.map((game) => (
              <li key={game.slug} className="bg-[var(--color-graphite)]">
                <Link
                  href={`/games/${game.slug}`}
                  className="flex items-center justify-between gap-4 p-[var(--spacing-4)] transition-colors hover:bg-[var(--color-graphite-raised)]"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{game.title}</span>
                    <span className="mt-0.5 block text-xs text-[var(--color-muted)]">
                      {game.category}
                    </span>
                  </span>
                  <StatusPill>Unranked</StatusPill>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}
