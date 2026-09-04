import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { GameCard } from '@/components/ui/game-card'
import { DemoBadge, StatusPill } from '@/components/ui/badges'
import { demoDevelopers, demoGames, getDemoDeveloper } from '@/lib/content/demo'
import { features } from '@/lib/flags'

type Props = { params: Promise<{ slug: string }> }

export function generateStaticParams() {
  return demoDevelopers.map((dev) => ({ slug: dev.slug }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const dev = getDemoDeveloper(slug)
  if (!dev) return {}
  return { title: dev.name, description: dev.bio }
}

export default async function DeveloperPage({ params }: Props) {
  const { slug } = await params
  const dev = getDemoDeveloper(slug)
  if (!dev) notFound()

  // Derived from the catalogue rather than from the developer's own list, so a
  // studio page cannot claim a game the catalogue does not attribute to it.
  const games = demoGames.filter((g) => g.developerSlug === dev.slug)
  const ranked = games.filter((g) => g.scoreVerification === 'deterministic-replay')

  return (
    <article className="pt-[var(--spacing-7)] pb-[var(--spacing-6)]">
      <Link
        href="/developers"
        className="text-sm text-[var(--color-muted)] transition-colors hover:text-bone"
      >
        ← All developers
      </Link>

      <header className="mt-[var(--spacing-5)]">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <StatusPill>Publisher</StatusPill>
          {dev.demo && <DemoBadge label="Demo studio" />}
        </div>
        <h1 className="font-display text-[clamp(2rem,7vw,3rem)] leading-[1] font-bold tracking-[var(--tracking-display)] uppercase">
          {dev.name}
        </h1>
        <p className="mt-[var(--spacing-4)] max-w-xl text-[var(--color-muted)]">{dev.bio}</p>
      </header>

      <div className="mt-[var(--spacing-6)] grid gap-px overflow-hidden rounded-[var(--radius-large)] border border-[var(--color-subtle-border)] bg-[var(--color-subtle-border)] sm:grid-cols-3">
        <Fact label="Published games" value={String(games.length)} />
        <Fact label="With verified scoring" value={String(ranked.length)} />
        {/* Not "0 players" dressed up as a milestone: there are no stored
            sessions yet, and the catalogue's own counter is the source. */}
        <Fact
          label="Verified players"
          value={games.reduce((n, g) => n + g.verifiedPlayers, 0).toLocaleString('en-US')}
        />
      </div>

      <section className="mt-[var(--spacing-7)]">
        <h2 className="mb-[var(--spacing-4)] font-display text-sm font-bold tracking-[var(--tracking-label)] uppercase">
          Games
        </h2>
        {games.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">
            Nothing published yet.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-[var(--spacing-4)] lg:grid-cols-4">
            {games.map((game) => (
              <GameCard key={game.slug} game={game} />
            ))}
          </div>
        )}
      </section>

      {ranked.length > 0 && (
        <section className="mt-[var(--spacing-7)]">
          <h2 className="mb-[var(--spacing-4)] font-display text-sm font-bold tracking-[var(--tracking-label)] uppercase">
            Leaderboards
          </h2>
          <ul className="grid gap-2">
            {ranked.map((game) => (
              <li key={game.slug}>
                <Link
                  href={`/leaderboards/${game.slug}`}
                  className="flex min-h-[var(--tap-target)] items-center justify-between gap-4 rounded-[var(--radius-medium)] border border-[var(--color-subtle-border)] bg-[var(--color-graphite)] px-[var(--spacing-4)] transition-colors hover:border-bone/25"
                >
                  <span className="truncate font-medium">{game.title}</span>
                  <span className="shrink-0 text-xs text-[var(--color-muted)]">
                    {game.scoreDirection === 'lower' ? 'Lowest wins' : 'Highest wins'} →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="ccg-surface mt-[var(--spacing-7)] max-w-xl rounded-[var(--radius-large)] p-[var(--spacing-5)]">
        <h2 className="font-display text-sm font-bold tracking-[var(--tracking-label)] uppercase">
          What this page does not show
        </h2>
        <p className="mt-3 text-sm text-[var(--color-muted)]">
          {features.developerPayouts
            ? 'Revenue figures are shown only where a recorded ledger backs them.'
            : 'No revenue, earnings or payout figure appears here, because no ledger exists to produce one. A number with nothing behind it is worse than an empty space.'}
        </p>
      </section>
    </article>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[var(--color-graphite)] p-[var(--spacing-4)]">
      <p className="text-[10px] font-bold tracking-[var(--tracking-label)] text-[var(--color-muted)] uppercase">
        {label}
      </p>
      <p className="mt-1.5 font-display text-2xl font-bold tracking-[var(--tracking-display)]">
        {value}
      </p>
    </div>
  )
}
