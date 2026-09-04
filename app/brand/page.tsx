import type { Metadata } from 'next'
import { CcgCascade, CcgTile, CcgTriTile, CcgWordmark } from '@/components/brand/logo'

export const metadata: Metadata = { title: 'Brand', robots: { index: false } }

const VARIANTS = [
  { key: 'A', name: 'Cascade', Mark: CcgCascade, note: 'Overlapping letterforms, knockout gaps' },
  { key: 'B', name: 'Tri-tile', Mark: CcgTriTile, note: 'Three connected tiles, letters drop below 28px' },
  { key: 'C', name: 'Tile', Mark: CcgTile, note: 'Single notched tile, stacked letters' },
]

/** Internal reference sheet for choosing the mark. Not indexed, not in the nav. */
export default function BrandPage() {
  return (
    <div className="py-[var(--spacing-7)]">
      <h1 className="font-display text-3xl font-semibold tracking-[var(--tracking-display)]">Mark options</h1>
      <p className="mt-2 text-sm text-[var(--color-muted)]">
        Each row: large, small, favicon size, and one-colour. A mark only works if the
        16px and one-colour cells still read.
      </p>

      <div className="mt-[var(--spacing-6)] grid gap-[var(--spacing-4)]">
        {VARIANTS.map(({ key, name, Mark, note }) => (
          <section key={key} className="ccg-surface rounded-[var(--radius-large)] p-[var(--spacing-5)]">
            <div className="mb-5 flex items-baseline gap-3">
              <h2 className="font-display text-xl font-bold">{key} — {name}</h2>
              <span className="text-xs text-[var(--color-muted)]">{note}</span>
            </div>

            <div className="flex flex-wrap items-end gap-10">
              <Cell label="96px"><Mark size={96} /></Cell>
              <Cell label="40px"><Mark size={40} /></Cell>
              <Cell label="16px"><Mark size={16} /></Cell>
              <Cell label="one colour">
                <span className="text-bone"><Mark size={56} monochrome /></span>
              </Cell>
              <Cell label="on accent">
                <span className="grid size-[72px] place-items-center rounded-[var(--radius-medium)] bg-accent-solid text-white">
                  <Mark size={44} monochrome />
                </span>
              </Cell>
              <Cell label="lockup"><CcgWordmark size={40} Mark={Mark} /></Cell>
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex min-h-[96px] items-center">{children}</div>
      <span className="text-[10px] tracking-[var(--tracking-label)] text-[var(--color-muted)] uppercase">
        {label}
      </span>
    </div>
  )
}
