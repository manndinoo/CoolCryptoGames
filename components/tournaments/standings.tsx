import type { StandingEntry } from '@/lib/tournaments/types'
import { heldResults, rankStandings } from '@/lib/tournaments/rules'
import { StatusPill } from '@/components/ui/badges'

/**
 * Final standings, plus a separate panel for results still under review.
 *
 * Held results are shown but never ranked. Placing a result that might later be
 * rejected would mean publishing a standing that can be retracted, so they sit
 * outside the table with no position attached.
 */
export function Standings({
  entries,
  direction,
}: {
  entries: StandingEntry[]
  direction: 'higher' | 'lower'
}) {
  const ranked = rankStandings(entries, direction)
  const held = heldResults(entries)

  if (ranked.length === 0 && held.length === 0) {
    return (
      <p className="text-sm text-[var(--color-muted)]">
        No verified results yet. Standings populate as runs are verified.
      </p>
    )
  }

  return (
    <>
      {ranked.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] tracking-[var(--tracking-label)] text-[var(--color-muted)] uppercase">
                <th scope="col" className="py-2 pr-4 font-semibold">#</th>
                <th scope="col" className="py-2 pr-4 font-semibold">Wallet</th>
                <th scope="col" className="py-2 pr-4 text-right font-semibold">Score</th>
                <th scope="col" className="py-2 text-right font-semibold">Verified</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((e, i) => (
                <tr key={e.entryId} className="border-t border-[var(--color-subtle-border)]">
                  <td className="py-2.5 pr-4 font-display font-bold">{i + 1}</td>
                  <td className="py-2.5 pr-4 font-mono text-xs">
                    {e.wallet.slice(0, 4)}…{e.wallet.slice(-4)}
                  </td>
                  <td className="py-2.5 pr-4 text-right font-medium">{e.score}</td>
                  <td className="py-2.5 text-right text-xs text-[var(--color-muted)]">
                    {e.verifiedAt ? new Date(e.verifiedAt).toISOString().slice(11, 16) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-[var(--color-muted)]">No verified results yet.</p>
      )}

      {held.length > 0 && (
        <div className="mt-[var(--spacing-5)] border-t border-[var(--color-subtle-border)] pt-4">
          <div className="mb-3 flex items-center gap-2">
            <h3 className="font-display text-xs font-bold tracking-[var(--tracking-label)] uppercase">
              Under review
            </h3>
            <StatusPill tone="alert">{held.length} held</StatusPill>
          </div>
          <ul className="grid gap-2 text-sm text-[var(--color-muted)]">
            {held.map((e) => (
              <li key={e.entryId} className="flex justify-between gap-4">
                <span className="font-mono text-xs">
                  {e.wallet.slice(0, 4)}…{e.wallet.slice(-4)}
                </span>
                <span>Not placed until verified</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-[var(--color-muted)]">
            A held result does not occupy a position, whatever it scored. It enters
            standings only if review verifies it.
          </p>
        </div>
      )}
    </>
  )
}
