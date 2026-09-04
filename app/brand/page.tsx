import type { Metadata } from 'next'
import { CcgMonogram, CcgStacked, CcgWordmark } from '@/components/brand/logo'

export const metadata: Metadata = { title: 'Brand', robots: { index: false } }

const SWATCHES = [
  { name: 'Accent', value: '#FE3F0E', note: 'The one accent. Primary action, live, active.' },
  { name: 'Cream', value: '#F1ECE4', note: 'Text on dark, and the light surface.' },
  { name: 'Ink', value: '#0D0D0F', note: 'Text on cream. The sheet’s black.' },
  { name: 'Ground', value: '#08090B', note: 'The page.' },
  { name: 'Surface', value: '#121416', note: 'Cards.' },
  { name: 'Raised', value: '#1A1D21', note: 'Hover and active surfaces.' },
]

export default function BrandPage() {
  return (
    <div className="pt-[var(--spacing-7)] pb-[var(--spacing-8)]">
      <h1 className="font-display text-4xl font-black tracking-[var(--tracking-display)] uppercase">
        Brand
      </h1>
      <p className="mt-3 max-w-xl text-[var(--color-muted)]">
        The supplied artwork, as it ships. The lockups are the identity’s own files
        keyed to transparency — nothing here is redrawn.
      </p>

      <Section title="Lockups">
        <div className="ccg-surface flex flex-wrap items-center gap-[var(--spacing-7)] p-[var(--spacing-6)]">
          <CcgWordmark size={44} />
          <CcgMonogram size={52} />
          <CcgStacked size={92} />
        </div>
        <div className="mt-px flex flex-wrap items-center gap-[var(--spacing-7)] bg-[var(--color-cream)] p-[var(--spacing-6)]">
          <CcgWordmark size={44} ink="dark" />
          <CcgMonogram size={52} ink="dark" />
        </div>
      </Section>

      <Section title="At size">
        <div className="ccg-surface flex flex-wrap items-end gap-[var(--spacing-6)] p-[var(--spacing-6)]">
          {[16, 24, 32, 48, 64].map((s) => (
            <span key={s} className="text-center">
              <CcgMonogram size={s} />
              <span className="mt-3 block text-[10px] tracking-[var(--tracking-label)] text-[var(--color-muted)]">
                {s}px
              </span>
            </span>
          ))}
        </div>
      </Section>

      <Section title="Colour">
        <div className="grid gap-px bg-[var(--color-line)] sm:grid-cols-2 lg:grid-cols-3">
          {SWATCHES.map((s) => (
            <div key={s.name} className="bg-[var(--color-graphite)] p-[var(--spacing-5)]">
              <span
                className="block h-16 w-full border border-white/10"
                style={{ background: s.value }}
              />
              <p className="mt-3 font-display text-sm font-bold uppercase">{s.name}</p>
              <p className="font-mono text-xs text-[var(--color-muted)]">{s.value}</p>
              <p className="mt-1.5 text-xs text-[var(--color-muted)]">{s.note}</p>
            </div>
          ))}
        </div>
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-[var(--spacing-7)]">
      <h2 className="mb-[var(--spacing-4)] text-[11px] font-bold tracking-[var(--tracking-label)] text-[var(--color-muted)] uppercase">
        {title}
      </h2>
      {children}
    </section>
  )
}
