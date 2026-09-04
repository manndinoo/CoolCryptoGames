import type { Metadata } from 'next'
import Link from 'next/link'
import { DemoBadge, StatusPill } from '@/components/ui/badges'
import { demoDevelopers, demoGames } from '@/lib/content/demo'
import { features } from '@/lib/flags'
import { gridColumns } from '@/lib/ui/columns'

export const metadata: Metadata = {
  title: 'Developers',
  description:
    'The studios publishing on CCG, what they have shipped, and how a build reaches the catalogue.',
}

export default function DevelopersPage() {
  const columns = gridColumns(demoDevelopers.length, 2)

  return (
    <>
      <header className="pt-[var(--spacing-7)]">
        <h1 className="font-display text-4xl font-black tracking-[var(--tracking-display)] uppercase">
          Developers
        </h1>
        <p className="mt-3 max-w-xl text-[var(--color-muted)]">
          Everything in the catalogue is published by a named studio and reviewed before
          it goes live. Nothing publishes automatically, and no build reaches players
          without a person approving that exact version.
        </p>
      </header>

      <ul
        className={`ccg-stagger mt-[var(--spacing-6)] grid gap-[var(--spacing-4)] ${columns}`}
      >
        {demoDevelopers.map((dev) => {
          const games = demoGames.filter((g) => g.developerSlug === dev.slug)
          const ranked = games.filter(
            (g) => g.scoreVerification === 'deterministic-replay',
          ).length

          return (
            <li key={dev.slug}>
              <Link
                href={`/developers/${dev.slug}`}
                className="ccg-surface ccg-lift block h-full rounded-[var(--radius-large)] p-[var(--spacing-5)]"
              >
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <StatusPill>{games.length === 1 ? '1 game' : `${games.length} games`}</StatusPill>
                  {ranked > 0 && <StatusPill>{ranked} ranked</StatusPill>}
                  {dev.demo && <DemoBadge label="Demo studio" />}
                </div>

                <h2 className="font-display text-2xl font-extrabold tracking-[var(--tracking-display)] uppercase">
                  {dev.name}
                </h2>
                <p className="mt-2 text-sm text-[var(--color-muted)]">{dev.bio}</p>

                <p className="mt-[var(--spacing-4)] truncate text-xs text-[var(--color-muted)]">
                  {games.map((g) => g.title).join(' · ')}
                </p>
              </Link>
            </li>
          )
        })}
      </ul>

      {/* ------------------------------------------------------- publishing */}
      <section className="mt-[var(--spacing-7)] grid gap-[var(--spacing-4)] lg:grid-cols-2">
        <div className="ccg-surface rounded-[var(--radius-large)] p-[var(--spacing-5)]">
          <h2 className="font-display text-[11px] font-bold tracking-[var(--tracking-label)] text-[var(--color-muted)] uppercase">
            How a build reaches players
          </h2>
          <ol className="mt-[var(--spacing-4)] grid gap-3 text-sm text-[var(--color-muted)]">
            <Step n={1}>
              A studio submits a build. It is pinned to an exact hash — a tournament
              binds to that hash, so the version played cannot change underneath an
              event.
            </Step>
            <Step n={2}>
              The build is reviewed by a person, including what it asks of the player.
              A game may never initiate a wallet transaction or an approval.
            </Step>
            <Step n={3}>
              It runs in a sandboxed frame with no access to platform cookies, wallet
              keys, or any wallet provider. It learns that a match is in progress and
              nothing about who is playing it.
            </Step>
            <Step n={4}>
              If the game can be replayed server-side, it gets a leaderboard. If it
              cannot, it ships unranked rather than shipping with scores nobody checked.
            </Step>
          </ol>
        </div>

        <div className="ccg-surface rounded-[var(--radius-large)] p-[var(--spacing-5)]">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-display text-[11px] font-bold tracking-[var(--tracking-label)] text-[var(--color-muted)] uppercase">
              Submissions
            </h2>
            <StatusPill tone={features.openGameSubmissions ? 'neutral' : 'alert'}>
              {features.openGameSubmissions ? 'Open' : 'Closed'}
            </StatusPill>
          </div>

          {features.openGameSubmissions ? (
            <p className="mt-3 text-sm text-[var(--color-muted)]">
              Open submissions are enabled in this environment. Every build still goes
              through the review above before it is listed.
            </p>
          ) : (
            <p className="mt-3 text-sm text-[var(--color-muted)]">
              The catalogue is curated and not accepting open submissions yet. There is
              no queue to join and no form that would pretend otherwise — when this
              opens, it will open here.
            </p>
          )}

          <h3 className="mt-[var(--spacing-5)] font-display text-[11px] font-bold tracking-[var(--tracking-label)] text-[var(--color-muted)] uppercase">
            Revenue
          </h3>
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            {features.developerPayouts
              ? 'Payouts are enabled in this environment. Terms are agreed per studio and paid against a recorded ledger.'
              : 'Payouts are switched off, no ledger exists, and no revenue figure is being quoted to anyone. Any earnings claim you see elsewhere is not coming from this platform.'}
          </p>
        </div>
      </section>
    </>
  )
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-[var(--color-subtle-border)] font-display text-[10px] font-bold text-bone">
        {n}
      </span>
      <span>{children}</span>
    </li>
  )
}
