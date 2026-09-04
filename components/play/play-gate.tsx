'use client'

import { useState } from 'react'
import { useWalletAuth } from './use-wallet-auth'
import { UsernameSetup } from './username-setup'
import { WalletSheet } from './wallet-sheet'

type GameSummary = { slug: string; title: string; status: 'playable' | 'coming-soon' }

/**
 * Guards the theater.
 *
 * The page around this is fully public — the gate appears only where the game
 * itself would mount, and only once someone actually presses Play. Loading a
 * game page must never trigger a wallet prompt on its own.
 */
export function PlayGate({ game }: { game: GameSummary }) {
  const { state, signIn, setUsername, connected } = useWalletAuth()
  const [requested, setRequested] = useState(false)

  if (game.status === 'coming-soon') {
    return (
      <div className="ccg-surface grid aspect-video w-full place-items-center rounded-[var(--radius-large)] text-center">
        <div className="p-6">
          <p className="font-display text-sm font-bold tracking-[var(--tracking-label)] uppercase">
            Not released
          </p>
          <p className="mt-2 max-w-sm text-sm text-[var(--color-muted)]">
            This catalogue entry is in review. New builds never publish automatically.
          </p>
        </div>
      </div>
    )
  }

  if (state.status === 'needs-username' && requested) {
    return <UsernameSetup onDone={setUsername} />
  }

  if (state.status === 'signed-in' && requested) {
    return (
      <div className="ccg-surface grid aspect-video w-full place-items-center rounded-[var(--radius-large)] text-center">
        <div className="p-6">
          <p className="font-display text-sm font-bold tracking-[var(--tracking-label)] uppercase">
            Runtime not yet wired
          </p>
          <p className="mt-2 max-w-md text-sm text-[var(--color-muted)]">
            Authentication succeeded. The sandboxed runtime and the server-issued play
            capability that mounts it are the next build step — no game frame will load
            until the server can scope a capability to this exact game and build.
          </p>
        </div>
      </div>
    )
  }

  if (!requested) {
    return (
      <div className="ccg-surface relative grid aspect-video w-full place-items-center overflow-hidden rounded-[var(--radius-large)]">
        <button
          onClick={() => setRequested(true)}
          className="inline-flex min-h-[var(--tap-target)] items-center gap-3 rounded-[var(--radius-pill)] bg-acid px-8 text-sm font-bold tracking-[var(--tracking-label)] text-carbon uppercase transition-opacity hover:opacity-90"
        >
          Play {game.title}
        </button>
      </div>
    )
  }

  return <WalletSheet state={state} onSignIn={signIn} connected={connected} />
}
