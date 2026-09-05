import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { BoardTable, EmptyBoard } from '@/components/leaderboards/board-table'
import { StatusPill, VerifiedBadge } from '@/components/ui/badges'
import { readSession, sessionCookie } from '@/lib/auth/session'
import { getDemoGame } from '@/lib/content/demo'
import { readBoard, type Board } from '@/lib/leaderboards/board'

type Props = { params: Promise<{ slug: string }> }

export const dynamic = 'force-dynamic'

const BOARD_LIMIT = 100

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const game = getDemoGame(slug)
  if (!game) return {}
  return {
    title: `${game.title} leaderboard`,
    description: `Verified standings for ${game.title}.`,
  }
}

export default async function GameLeaderboardPage({ params }: Props) {
  const { slug } = await params
  const game = getDemoGame(slug)
  if (!game) notFound()

  const ranked = game.scoreVerification === 'deterministic-replay'

  // Only used to mark the reader's own row. The session carries the username,
  // so no address is read here and none could be rendered.
  const jar = await cookies()
  const claims = await readSession(jar.get(sessionCookie.name)?.value)

  let board: Board | null = null
  let failed = false
  if (ranked) {
    try {
      board = await readBoard(game.slug, game.scoreDirection, BOARD_LIMIT)
    } catch (err) {
      console.error('[ccg] leaderboard read failed:', err)
      failed = true
    }
  }

  return (
    <article className="pt-[var(--spacing-7)] pb-[var(--spacing-6)]">
      <Link
        href="/leaderboards"
        className="text-sm text-[var(--color-muted)] transition-colors hover:text-bone"
      >
        ← All leaderboards
      </Link>

      <header className="mt-[var(--spacing-5)] flex items-start gap-[var(--spacing-4)]">
        {game.cover && (
          <div className="relative size-20 shrink-0 overflow-hidden rounded-[var(--radius-medium)] border border-[var(--color-subtle-border)] sm:size-24">
            <Image
              src={game.cover}
              alt=""
              aria-hidden
              fill
              sizes="96px"
              className="object-cover object-center"
            />
          </div>
        )}
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {ranked ? <VerifiedBadge /> : <StatusPill>Unranked</StatusPill>}
            {ranked && (
              <StatusPill>
                {game.scoreDirection === 'lower' ? 'Lowest wins' : 'Highest wins'}
              </StatusPill>
            )}
          </div>
          <h1 className="font-display text-[clamp(1.9rem,6vw,2.8rem)] leading-[1.05] font-black tracking-[var(--tracking-display)] uppercase">
            {game.title}
          </h1>
          <Link
            href={`/games/${game.slug}`}
            className="mt-2 inline-block text-sm text-[var(--color-muted)] transition-colors hover:text-bone"
          >
            Game page →
          </Link>
        </div>
      </header>

      {!ranked ? (
        <section className="ccg-surface mt-[var(--spacing-6)] max-w-xl rounded-[var(--radius-large)] p-[var(--spacing-5)]">
          <h2 className="font-display text-[11px] font-bold tracking-[var(--tracking-label)] text-[var(--color-muted)] uppercase">
            No board for this game
          </h2>
          <p className="mt-3 text-sm text-[var(--color-muted)]">
            {game.title} has no server-side replay, so a score from it is a number the
            client reported and nothing has checked. Publishing that as a ranking would
            be presenting an unverified claim as a result, so it is not published at
            all. The game is open to play in the meantime.
          </p>
          <Link
            href={`/games/${game.slug}`}
            className="mt-[var(--spacing-5)] ccg-btn ccg-btn-primary"
          >
            Play {game.title}
          </Link>
        </section>
      ) : (
        <>
          <div className="mt-[var(--spacing-6)] grid gap-[var(--spacing-4)] sm:grid-cols-3">
            <Stat label="Ranked players" value={failed ? '—' : String(board?.players ?? 0)} />
            <Stat
              label="Score model"
              value={game.scoreDirection === 'lower' ? 'Lower is better' : 'Higher is better'}
            />
            <Stat label="Best result per player" value="One" />
          </div>

          <section className="ccg-surface mt-[var(--spacing-5)] rounded-[var(--radius-large)] px-[var(--spacing-5)] py-2">
            {failed ? (
              <p className="py-6 text-sm text-[var(--color-muted)]">
                Standings could not be loaded right now. Nothing has been recalculated —
                this is a storage problem on our side.
              </p>
            ) : board && board.entries.length > 0 ? (
              <BoardTable
                entries={board.entries}
                unit={game.scoreUnit}
                highlightName={claims?.username ?? null}
              />
            ) : (
              <EmptyBoard direction={game.scoreDirection} />
            )}
          </section>

          <section className="mt-[var(--spacing-6)] max-w-xl">
            <h2 className="font-display text-[11px] font-bold tracking-[var(--tracking-label)] text-[var(--color-muted)] uppercase">
              How a place is earned
            </h2>
            <ul className="mt-3 grid gap-2 text-sm text-[var(--color-muted)]">
              <li>
                The client sends what the player pressed, never a score. The server
                replays the run from those inputs and takes its own result.
              </li>
              <li>
                A player holds one place, on their best verified result. Extra runs
                improve that place; they do not add rows.
              </li>
              <li>
                Equal scores share a place. The next place skips, so two players level
                at 1st are followed by 3rd.
              </li>
              <li>
                Results belonging to a banned wallet stop being published. They are kept
                for review rather than deleted.
              </li>
            </ul>
          </section>
        </>
      )}
    </article>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-medium)] border border-[var(--color-subtle-border)] bg-[var(--color-graphite)] p-[var(--spacing-4)]">
      <p className="text-[10px] font-bold tracking-[var(--tracking-label)] text-[var(--color-muted)] uppercase">
        {label}
      </p>
      <p className="mt-1.5 font-display text-lg font-bold tracking-[var(--tracking-display)]">
        {value}
      </p>
    </div>
  )
}
