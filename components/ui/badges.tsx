/**
 * Status badges.
 *
 * `DemoBadge` is a truthfulness requirement, not decoration: seeded records
 * must be visibly distinguishable from real ones everywhere they appear.
 */

export function DemoBadge({ label = 'Demo' }: { label?: string }) {
  return (
    <span className="inline-flex items-center rounded-[var(--radius-pill)] border border-[var(--color-subtle-border)] bg-[var(--color-graphite)] px-2 py-0.5 text-[10px] font-bold tracking-[var(--tracking-label)] text-[var(--color-muted)] uppercase">
      {label}
    </span>
  )
}

/** Acid is reserved for verified and live states — this is one of them. */
export function VerifiedBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-[var(--radius-pill)] border border-[var(--color-strong-border)] px-2 py-0.5 text-[10px] font-bold tracking-[var(--tracking-label)] text-acid uppercase">
      <svg viewBox="0 0 12 12" className="size-3" aria-hidden>
        <path
          d="m2.5 6.2 2.2 2.2 4.8-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      Verified
    </span>
  )
}

export function StatusPill({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode
  tone?: 'neutral' | 'alert'
}) {
  // Orange is reserved for alerts and expiring states.
  const toneClass =
    tone === 'alert'
      ? 'border-[color-mix(in_srgb,var(--color-orange)_60%,transparent)] text-[var(--color-orange)]'
      : 'border-[var(--color-subtle-border)] text-[var(--color-muted)]'

  return (
    <span
      className={`inline-flex items-center rounded-[var(--radius-pill)] border px-2.5 py-0.5 text-[10px] font-bold tracking-[var(--tracking-label)] uppercase ${toneClass}`}
    >
      {children}
    </span>
  )
}
