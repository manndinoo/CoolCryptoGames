'use client'

import { useEffect, useState } from 'react'
import { useWalletAuth } from '@/components/play/use-wallet-auth'
import { WalletSheet } from '@/components/play/wallet-sheet'
import { eligibilityMessage, type EligibilityReason } from '@/lib/tournaments/rules'
import type { Tournament } from '@/lib/tournaments/types'

type EntryState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'entered' }
  | { status: 'refused'; reason: EligibilityReason | string }

/**
 * Entry requires two separate things: a verified wallet session, and explicit
 * acceptance of the exact rules version on screen.
 *
 * Nothing here is authoritative. The checkbox and the button only decide what
 * the panel shows — the server re-runs the whole eligibility check on the
 * request, because a disabled button stops nobody.
 */
export function EntryPanel({ tournament }: { tournament: Tournament }) {
  const { state: auth, signIn, connected } = useWalletAuth()
  const [accepted, setAccepted] = useState(false)
  const [entry, setEntry] = useState<EntryState>({ status: 'idle' })
  const [showWallet, setShowWallet] = useState(false)

  // Re-accepting is required if the rules are republished while the page is open.
  useEffect(() => setAccepted(false), [tournament.rules.version])

  const signedIn = auth.status === 'signed-in'

  async function submit() {
    setEntry({ status: 'submitting' })
    try {
      const res = await fetch(`/api/tournaments/${tournament.slug}/enter`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ acceptedRulesVersion: tournament.rules.version }),
      })
      const data = await res.json()
      setEntry(res.ok ? { status: 'entered' } : { status: 'refused', reason: data.reason ?? data.error })
    } catch {
      setEntry({ status: 'refused', reason: 'network_error' })
    }
  }

  if (showWallet && !signedIn) {
    return <WalletSheet state={auth} onSignIn={signIn} connected={connected} />
  }

  return (
    <section className="ccg-surface rounded-[var(--radius-large)] p-[var(--spacing-5)]">
      <h2 className="font-display text-[11px] font-bold tracking-[var(--tracking-label)] text-[var(--color-muted)] uppercase">
        Enter
      </h2>

      <p className="mt-3 text-sm text-[var(--color-muted)]">
        Entry is free. No fee, deposit, stake, or purchasable attempt exists for this or
        any CCG event.
      </p>

      {entry.status === 'entered' ? (
        <p className="mt-[var(--spacing-5)] rounded-[var(--radius-medium)] border border-[var(--color-strong-border)] p-4 text-sm text-accent">
          You're entered. Your verified runs will appear in standings.
        </p>
      ) : (
        <>
          <label className="mt-[var(--spacing-5)] flex cursor-pointer items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]"
            />
            <span className="text-[var(--color-muted)]">
              I accept the official rules, version{' '}
              <span className="text-bone">{tournament.rules.version}</span>.
            </span>
          </label>

          <button
            onClick={() => (signedIn ? submit() : setShowWallet(true))}
            disabled={!accepted || entry.status === 'submitting'}
            className="mt-[var(--spacing-5)] ccg-btn ccg-btn-primary disabled:cursor-not-allowed disabled:bg-[var(--color-graphite-raised)] disabled:text-[var(--color-muted)]"
          >
            {entry.status === 'submitting'
              ? 'Entering…'
              : signedIn
                ? 'Enter tournament'
                : 'Connect wallet to enter'}
          </button>

          {entry.status === 'refused' && (
            <p className="mt-4 text-sm text-[var(--color-orange)]">
              {eligibilityMessage(entry.reason as EligibilityReason) ??
                'Entry could not be completed.'}
            </p>
          )}
        </>
      )}
    </section>
  )
}
