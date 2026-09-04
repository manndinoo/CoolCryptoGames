import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { DemoBadge, StatusPill, VerifiedBadge } from '@/components/ui/badges'
import { PlayGate } from '@/components/play/play-gate'
import { demoGames, getDemoDeveloper, getDemoGame } from '@/lib/content/demo'

type Props = { params: Promise<{ slug: string }> }

export function generateStaticParams() {
  return demoGames.map((game) => ({ slug: game.slug }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const game = getDemoGame(slug)
  return game ? { title: game.title, description: game.blurb } : {}
}

export default async function GamePage({ params }: Props) {
  const { slug } = await params
  const game = getDemoGame(slug)
  if (!game) notFound()

  const developer = getDemoDeveloper(game.developerSlug)

  return (
    <article className="pt-[var(--spacing-6)]">
      <Link
        href="/games"
        className="text-sm text-[var(--color-muted)] transition-colors hover:text-bone"
      >
        ← All games
      </Link>

      <header className="mt-[var(--spacing-5)]">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-bold tracking-[var(--tracking-label)] text-[var(--color-muted)] uppercase">
            {game.category}
          </span>
          {game.demo && <DemoBadge />}
          {game.scoreVerification === 'deterministic-replay' ? (
            <VerifiedBadge />
          ) : (
            <StatusPill>Unranked</StatusPill>
          )}
        </div>

        <h1 className="font-display text-4xl font-bold tracking-[var(--tracking-display)] lg:text-5xl">
          {game.title}
        </h1>

        {developer && (
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            by{' '}
            <Link href={`/developers/${developer.slug}`} className="text-bone hover:text-acid">
              {developer.name}
            </Link>
          </p>
        )}

        <p className="mt-[var(--spacing-4)] max-w-xl text-[var(--color-muted)]">{game.blurb}</p>
      </header>

      {/* The theater. Nothing mounts here until the server has issued a
          play capability for this specific game and build. */}
      <div className="mt-[var(--spacing-6)]">
        <PlayGate
          game={{
            slug: game.slug,
            title: game.title,
            status: game.status,
            ranked: game.scoreVerification === 'deterministic-replay',
          }}
        />
      </div>

      <section className="mt-[var(--spacing-7)] max-w-xl">
        <h2 className="font-display text-sm font-bold tracking-[var(--tracking-label)] uppercase">
          Score verification
        </h2>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          {game.scoreVerification === 'deterministic-replay'
            ? 'Runs of this game are replayed on the server from the inputs you produced, so a result can be independently confirmed before it reaches a leaderboard.'
            : 'This game has no server-side replay yet, so results are not ranked. It runs for play only.'}
        </p>
      </section>
    </article>
  )
}
