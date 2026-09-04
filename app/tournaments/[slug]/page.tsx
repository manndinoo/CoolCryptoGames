import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { DemoBadge, StatusPill, VerifiedBadge } from '@/components/ui/badges'
import { EntryPanel } from '@/components/tournaments/entry-panel'
import { WalletBoundary } from '@/components/play/wallet-boundary'
import { Standings } from '@/components/tournaments/standings'
import { demoTournaments, getDemoGame, getDemoStandings, getDemoTournament } from '@/lib/content/demo'
import { features } from '@/lib/flags'

type Props = { params: Promise<{ slug: string }> }

export function generateStaticParams() {
  return demoTournaments.map((t) => ({ slug: t.slug }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const t = getDemoTournament(slug)
  return t ? { title: t.name, description: t.format } : {}
}

export default async function TournamentPage({ params }: Props) {
  const { slug } = await params
  const tournament = getDemoTournament(slug)
  if (!tournament) notFound()

  const game = getDemoGame(tournament.gameSlug)
  const entries = getDemoStandings(slug)

  return (
    <article className="pt-[var(--spacing-6)]">
      <Link href="/tournaments" className="text-sm text-[var(--color-muted)] hover:text-bone">
        ← All tournaments
      </Link>

      <header className="mt-[var(--spacing-5)]">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <StatusPill>{tournament.status}</StatusPill>
          {tournament.demo && <DemoBadge label="Demo event" />}
        </div>
        <h1 className="font-display text-4xl font-black tracking-[var(--tracking-display)] uppercase lg:text-5xl">
          {tournament.name}
        </h1>
        <p className="mt-2 text-[var(--color-muted)]">{tournament.format}</p>
      </header>

      <div className="mt-[var(--spacing-6)] grid gap-[var(--spacing-4)] lg:grid-cols-[1.4fr_1fr] lg:items-start">
        <div className="grid gap-[var(--spacing-4)]">
          {/* ------------------------------------------------ official rules */}
          <section className="ccg-surface rounded-[var(--radius-large)] p-[var(--spacing-5)]">
            <div className="mb-4 flex items-baseline justify-between gap-4">
              <h2 className="font-display text-[11px] font-bold tracking-[var(--tracking-label)] text-[var(--color-muted)] uppercase">
                Official rules
              </h2>
              <span className="text-xs text-[var(--color-muted)]">
                v{tournament.rules.version} · published{' '}
                {new Date(tournament.rules.publishedAt).toISOString().slice(0, 10)}
              </span>
            </div>

            <dl className="grid gap-3 text-sm">
              <Field label="Score model" value={tournament.rules.scoreModel} />
              <Field label="Tie-breaker" value={tournament.rules.tieBreaker} />
              <Field
                label="Entry window"
                value={`${fmt(tournament.opensAt)} → ${fmt(tournament.closesAt)}`}
              />
              <Field label="Game" value={game?.title ?? tournament.gameSlug} />
              <Field label="Build" value={`${tournament.gameBuildHash.slice(0, 16)}…`} mono />
            </dl>

            <p className="mt-4 text-xs text-[var(--color-muted)]">
              The rules version and build hash are fixed for the life of the event. If a
              material defect changes competitive outcomes, the published cancellation or
              restart rule applies — a build is never silently replaced.
            </p>

            <h3 className="mt-[var(--spacing-5)] font-display text-[11px] font-bold tracking-[var(--tracking-label)] text-[var(--color-muted)] uppercase">
              Eligibility
            </h3>
            <ul className="mt-3 grid gap-2 text-sm text-[var(--color-muted)]">
              {tournament.rules.eligibility.map((line) => (
                <li key={line} className="flex gap-2">
                  <span aria-hidden className="text-accent">
                    ·
                  </span>
                  {line}
                </li>
              ))}
            </ul>
          </section>

          {/* ---------------------------------------------------- standings */}
          <section className="ccg-surface rounded-[var(--radius-large)] p-[var(--spacing-5)]">
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <h2 className="font-display text-[11px] font-bold tracking-[var(--tracking-label)] text-[var(--color-muted)] uppercase">
                Standings
              </h2>
              <VerifiedBadge />
            </div>
            <Standings entries={entries} direction={tournament.direction} />
          </section>
        </div>

        {/* --------------------------------------------------------- entry */}
        <div className="grid gap-[var(--spacing-4)]">
          <WalletBoundary>
            <EntryPanel tournament={tournament} />
          </WalletBoundary>

          <section className="ccg-surface rounded-[var(--radius-large)] p-[var(--spacing-5)]">
            <h2 className="font-display text-[11px] font-bold tracking-[var(--tracking-label)] text-[var(--color-muted)] uppercase">
              Prize
            </h2>
            <p className="mt-3 text-sm text-[var(--color-muted)]">
              {tournament.prize
                ? tournament.prize.label
                : 'No prize has been created or approved for this event.'}
            </p>
            {!features.realPrizes && (
              <p className="mt-3 text-xs text-[var(--color-muted)]">
                Prize awarding is disabled in this environment. Prizes, when they exist,
                are fixed and funded by CCG or a sponsor before entry opens — never
                pooled from entrants.
              </p>
            )}
          </section>
        </div>
      </div>
    </article>
  )
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-6 gap-y-1">
      <dt className="text-[var(--color-muted)]">{label}</dt>
      <dd className={`text-right font-medium ${mono ? 'font-mono text-xs' : ''}`}>{value}</dd>
    </div>
  )
}

function fmt(iso: string): string {
  return new Date(iso).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
}
