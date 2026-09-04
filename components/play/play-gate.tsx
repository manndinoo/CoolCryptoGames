'use client'

import { useState } from 'react'
import { useWalletAuth } from './use-wallet-auth'
import { UsernameSetup } from './username-setup'
import { WalletSheet } from './wallet-sheet'

type GameSummary = {
  slug: string
  title: string
  status: 'playable' | 'coming-soon'
  /** Whether the server can replay this game's runs and vouch for a score. */
  ranked: boolean
}

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
    // Unranked games mount directly: the wallet gate has been satisfied, and
    // there is no score to issue a capability for. Ranked games additionally
    // need a server-issued play capability scoped to an exact build.
    if (!game.ranked) {
      return (
        <div>
          <div className="overflow-hidden rounded-[var(--radius-large)] border border-[var(--color-subtle-border)] bg-carbon">
            <iframe
              src={`/games/${game.slug}/index.html`}
              title={game.title}
              className="aspect-[9/16] w-full sm:aspect-video"
              // No allow-same-origin: the frame runs on an opaque origin and
              // cannot reach this page's cookies, storage, or wallet provider.
              // No camera or microphone in `allow`, either.
              sandbox="allow-scripts"
              allow="autoplay; fullscreen; gamepad"
              referrerPolicy="no-referrer"
            />
          </div>
          <p className="mt-3 text-xs text-[var(--color-muted)]">
            This game runs unranked. Its results are not submitted to a leaderboard
            because the server cannot yet replay them independently.
          </p>
        </div>
      )
    }

    return (
      <div className="ccg-surface grid aspect-video w-full place-items-center rounded-[var(--radius-large)] text-center">
        <div className="p-6">
          <p className="font-display text-sm font-bold tracking-[var(--tracking-label)] uppercase">
            Ranked runtime not yet wired
          </p>
          <p className="mt-2 max-w-md text-sm text-[var(--color-muted)]">
            Authentication succeeded. A ranked session needs a server-issued play
            capability scoped to this exact build, which is the next build step.
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
