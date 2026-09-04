'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useWalletAuth } from '@/components/play/use-wallet-auth'
import { UsernameSetup } from '@/components/play/username-setup'
import { WalletSheet } from '@/components/play/wallet-sheet'
import { StatusPill } from '@/components/ui/badges'

/**
 * The connected player's profile.
 *
 * Every figure here is either real or absent. There are no stored sessions,
 * verified results or entries yet, so the panels show genuine empty states
 * rather than seeded activity — a demo badge on an invented match history
 * would still teach a player to read these numbers as theirs.
 */
export function ProfileView() {
  const { state, signIn, signOut, setUsername, connected } = useWalletAuth()
  const [addressShown, setAddressShown] = useState(false)

  if (state.status === 'loading') {
    return <p className="mt-6 text-sm text-[var(--color-muted)]">Loading…</p>
  }

  if (state.status === 'needs-username') {
    return (
      <div className="mt-[var(--spacing-6)]">
        <UsernameSetup onDone={setUsername} />
      </div>
    )
  }

  if (state.status !== 'signed-in') {
    return (
      <div className="mt-[var(--spacing-6)]">
        <p className="mb-[var(--spacing-5)] max-w-lg text-[var(--color-muted)]">
          Your profile is tied to the wallet you play with. Connect one to see your
          verified results, tournament entries, and account status.
        </p>
        <WalletSheet state={state} onSignIn={signIn} connected={connected} />
      </div>
    )
  }

  return (
    <div className="mt-[var(--spacing-6)] grid gap-[var(--spacing-4)]">
      <section className="ccg-surface rounded-[var(--radius-large)] p-[var(--spacing-5)]">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold tracking-[var(--tracking-label)] text-[var(--color-muted)] uppercase">
              Player name
            </p>
            <p className="mt-1 font-display text-2xl font-bold tracking-[var(--tracking-display)]">
              {state.username}
            </p>
            <p className="mt-1 text-xs text-[var(--color-muted)]">
              This is what other players see. Your wallet address is never shown publicly.
            </p>
          </div>
          <button
            onClick={signOut}
            className="min-h-[var(--tap-target)] shrink-0 rounded-[var(--radius-pill)] border border-[var(--color-subtle-border)] px-5 text-sm font-semibold transition-colors hover:border-bone/40"
          >
            Sign out
          </button>
        </div>

        {/* The address is shown only here, only to the person who controls it,
            and only on request. It is the credential behind the account, not
            part of the account's public identity. */}
        <div className="mt-[var(--spacing-5)] border-t border-[var(--color-subtle-border)] pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[10px] font-bold tracking-[var(--tracking-label)] text-[var(--color-muted)] uppercase">
              Connected wallet
            </p>
            <button
              onClick={() => setAddressShown((v) => !v)}
              className="text-xs font-semibold text-[var(--color-muted)] transition-colors hover:text-bone"
              aria-expanded={addressShown}
            >
              {addressShown ? 'Hide' : 'Show address'}
            </button>
          </div>
          <p className="mt-2 font-mono text-sm break-all">
            {addressShown ? state.wallet : '••••••••••••••••••••••••••••••••'}
          </p>
          <p className="mt-3 text-xs text-[var(--color-muted)]">
            Only you can see this. CCG holds no custody of this wallet and has no
            permission over its assets — signing in proved you control the key, nothing
            more.
          </p>
        </div>
      </section>

      <div className="grid gap-[var(--spacing-4)] lg:grid-cols-3">
        <Stat label="Verified results" value="0" note="Runs the server has independently confirmed." />
        <Stat label="Tournament entries" value="0" note="Events you have accepted rules for." />
        <Stat label="Account status" value="Good standing" note="No sanctions on this account." />
      </div>

      <section className="ccg-surface rounded-[var(--radius-large)] p-[var(--spacing-5)]">
        <h2 className="font-display text-sm font-bold tracking-[var(--tracking-label)] uppercase">
          Recent results
        </h2>
        <p className="mt-3 text-sm text-[var(--color-muted)]">
          No results yet. Verified runs appear here with the game, score, and the
          verification decision that placed them.
        </p>
        <Link
          href="/games"
          className="mt-[var(--spacing-5)] inline-flex min-h-[var(--tap-target)] items-center rounded-[var(--radius-pill)] border border-[var(--color-subtle-border)] px-6 text-sm font-semibold transition-colors hover:border-bone/40"
        >
          Find a game
        </Link>
      </section>

      <section className="ccg-surface rounded-[var(--radius-large)] p-[var(--spacing-5)]">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-display text-sm font-bold tracking-[var(--tracking-label)] uppercase">
            Appeals
          </h2>
          <StatusPill>None open</StatusPill>
        </div>
        <p className="mt-3 max-w-lg text-sm text-[var(--color-muted)]">
          Any decision that affects competition — a held result, a rejected score, a
          restriction on this account — can be appealed to a person. Appeals you raise
          appear here with their status and outcome.
        </p>
        <Link
          href="/settings"
          className="mt-[var(--spacing-5)] inline-flex min-h-[var(--tap-target)] items-center rounded-[var(--radius-pill)] border border-[var(--color-subtle-border)] px-6 text-sm font-semibold transition-colors hover:border-bone/40"
        >
          Privacy and data settings
        </Link>
      </section>
    </div>
  )
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="ccg-surface rounded-[var(--radius-large)] p-[var(--spacing-5)]">
      <p className="text-[10px] font-bold tracking-[var(--tracking-label)] text-[var(--color-muted)] uppercase">
        {label}
      </p>
      <p className="mt-2 font-display text-3xl font-bold tracking-[var(--tracking-display)]">
        {value}
      </p>
      <p className="mt-2 text-xs text-[var(--color-muted)]">{note}</p>
    </div>
  )
}
