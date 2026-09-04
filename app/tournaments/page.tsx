import type { Metadata } from 'next'
import Link from 'next/link'
import { DemoBadge, StatusPill } from '@/components/ui/badges'
import { demoTournaments } from '@/lib/content/demo'
import { features } from '@/lib/flags'

export const metadata: Metadata = {
  title: 'Tournaments',
  description: 'Free-entry competitions with published rules and verified results.',
}

export default function TournamentsPage() {
  return (
    <>
      <header className="pt-[var(--spacing-7)]">
        <h1 className="font-display text-4xl font-bold tracking-[var(--tracking-display)] uppercase">
          Tournaments
        </h1>
        <p className="mt-3 max-w-xl text-[var(--color-muted)]">
          Free entry, published rules, objective skill, and results the server verifies
          before they count. There is no entry fee, no deposit, and no purchasable attempt.
        </p>
      </header>

      {!features.realPrizes && (
        <p className="mt-[var(--spacing-5)] rounded-[var(--radius-medium)] border border-[var(--color-subtle-border)] bg-[var(--color-graphite)] p-4 text-sm text-[var(--color-muted)]">
          Prize awarding is switched off in this environment. Events below are
          demonstrations of the competition system — no prize has been created or
          approved, and none is being offered.
        </p>
      )}

      <ul className="mt-[var(--spacing-6)] grid gap-[var(--spacing-4)] lg:grid-cols-2">
        {demoTournaments.map((t) => (
          <li key={t.slug}>
            <Link
              href={`/tournaments/${t.slug}`}
              className="ccg-surface block rounded-[var(--radius-large)] p-[var(--spacing-5)] transition-colors hover:border-bone/25"
            >
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <StatusPill>{t.status}</StatusPill>
                {t.demo && <DemoBadge label="Demo event" />}
              </div>

              <h2 className="font-display text-2xl font-bold tracking-[var(--tracking-display)]">
                {t.name}
              </h2>
              <p className="mt-1 text-sm text-[var(--color-muted)]">{t.format}</p>

              <dl className="mt-[var(--spacing-4)] grid gap-2 text-sm">
                <Row label="Score model" value={t.rules.scoreModel} />
                <Row label="Rules version" value={t.rules.version} />
                <Row label="Prize" value={t.prize ? t.prize.label : 'Not yet announced'} />
              </dl>
            </Link>
          </li>
        ))}
      </ul>
    </>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-6">
      <dt className="shrink-0 text-[var(--color-muted)]">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  )
}
