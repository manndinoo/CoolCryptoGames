'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

const STORAGE_KEY = 'ccg:seen-intro'

/**
 * A one-time notice for a first-time visitor.
 *
 * This is the site's one interstitial, and it exists to answer the objection
 * that actually stops people here: a wallet-connected games site looks like a
 * site that wants to drain your wallet. Saying plainly, before anyone is asked
 * for anything, that browsing needs no wallet and playing needs no balance
 * removes a real barrier. That is the honest version of a conversion popup —
 * it converts by answering a question rather than by manufacturing pressure.
 *
 * What it deliberately is not:
 *
 *  - Not a modal. It never blocks the page, never traps focus, and the site
 *    behind it stays fully usable. An interstitial you have to defeat to read
 *    the thing you came for is the pattern regulators call a roach motel.
 *  - Not timed. No countdown, no "offer ends", no scarcity. The FTC lists fake
 *    urgency among the dark patterns it enforces against, and there is nothing
 *    here that expires anyway.
 *  - Not confirm-shaming. The dismiss control says "Got it", not something
 *    written to make declining feel stupid.
 *  - Not repeated. Dismissed once, gone for good on this device. A notice that
 *    comes back is an advert.
 *
 * It appears after a beat rather than immediately, so it does not race the
 * page's own entrance animation and arrive as a second thing moving.
 */
export function FirstVisitNotice() {
  const [state, setState] = useState<'hidden' | 'shown' | 'leaving'>('hidden')

  useEffect(() => {
    let seen = true
    try {
      seen = window.localStorage.getItem(STORAGE_KEY) === '1'
    } catch {
      // Storage blocked. Treating that as "already seen" is the polite
      // failure: showing it on every single page load would be worse than
      // never showing it at all.
    }
    if (seen) return

    const timer = window.setTimeout(() => setState('shown'), 900)
    return () => window.clearTimeout(timer)
  }, [])

  function dismiss() {
    setState('leaving')
    try {
      window.localStorage.setItem(STORAGE_KEY, '1')
    } catch {
      // Nothing to do. It simply reappears next session.
    }
    window.setTimeout(() => setState('hidden'), 220)
  }

  if (state === 'hidden') return null

  return (
    <div
      role="region"
      aria-label="Welcome"
      data-leaving={state === 'leaving' || undefined}
      className="ccg-notice fixed right-0 left-0 z-30 px-[var(--mobile-gutter)] lg:right-[var(--desktop-gutter)] lg:left-auto lg:w-[380px] lg:px-0"
      style={{
        bottom: 'calc(var(--mobile-bottom-nav) + var(--safe-bottom) + var(--spacing-3))',
      }}
    >
      <div className="ccg-surface rounded-[var(--radius-large)] p-[var(--spacing-5)] shadow-2xl">
        <p className="font-display text-lg font-bold tracking-[var(--tracking-display)]">
          Nothing here costs anything
        </p>
        <ul className="mt-3 grid gap-2 text-sm text-[var(--color-muted)]">
          <li>Browsing and watching need no wallet at all.</li>
          <li>
            Playing needs a wallet as your <em className="not-italic text-bone">name</em>, not your
            balance — an empty one works.
          </li>
          <li>No purchases, no deposits, no transaction to approve. Ever.</li>
        </ul>

        <div className="mt-[var(--spacing-5)] flex flex-wrap gap-2">
          <Link
            href="/games"
            onClick={dismiss}
            className="inline-flex min-h-[var(--tap-target)] items-center rounded-[var(--radius-pill)] bg-acid px-5 text-sm font-bold tracking-[var(--tracking-label)] text-carbon uppercase transition-transform duration-[var(--duration-fast)] hover:scale-[1.03] active:scale-[0.98]"
          >
            See the games
          </Link>
          {/* A plain, equally weighted dismiss. Making this one hard to find,
              or dressing it as a refusal of something good, is the pattern the
              rest of this component exists to avoid. */}
          <button
            onClick={dismiss}
            className="inline-flex min-h-[var(--tap-target)] items-center rounded-[var(--radius-pill)] border border-[var(--color-subtle-border)] px-5 text-sm font-semibold transition-colors duration-[var(--duration-fast)] hover:border-bone/40"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  )
}
