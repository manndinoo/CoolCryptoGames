'use client'

import dynamic from 'next/dynamic'
import { useWalletAuth } from './use-wallet-auth'

// The button reads wallet state that only exists in the browser, so rendering
// it on the server produces a hydration mismatch.
const WalletMultiButton = dynamic(
  () => import('@solana/wallet-adapter-react-ui').then((m) => m.WalletMultiButton),
  { ssr: false },
)

export function WalletGate({ children }: { children: React.ReactNode }) {
  const { state, signIn, signOut, connected } = useWalletAuth()

  if (state.status === 'signed-in') {
    return (
      <div>
        <div className="mb-6 flex items-center justify-between rounded-lg border border-white/10 bg-[var(--color-surface)] px-4 py-3 text-sm">
          <span className="text-white/60">
            Playing as{' '}
            <code className="text-white/90">
              {state.wallet.slice(0, 4)}…{state.wallet.slice(-4)}
            </code>
          </span>
          <button onClick={signOut} className="text-white/50 hover:text-white">
            Sign out
          </button>
        </div>
        {children}
      </div>
    )
  }

  if (state.status === 'blocked') {
    return (
      <Panel title="You can't play right now">
        <p className="text-white/60">
          This wallet, device or network is blocked: <code>{state.reason}</code>
        </p>
        <p className="mt-3 text-sm text-white/40">
          If you think that's wrong, get in touch and quote the code above.
        </p>
      </Panel>
    )
  }

  return (
    <Panel title="Connect a wallet to play">
      <p className="mb-6 text-white/60">
        Games are wallet-gated. Connecting costs nothing and authorises no
        transaction — you're signing a message to prove the wallet is yours.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <WalletMultiButton />
        {connected && (
          <button
            onClick={signIn}
            disabled={state.status === 'signing-in'}
            className="rounded-lg bg-[var(--color-accent)] px-5 py-2.5 font-medium transition hover:opacity-90 disabled:opacity-50"
          >
            {state.status === 'signing-in' ? 'Check your wallet…' : 'Sign in'}
          </button>
        )}
      </div>
    </Panel>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-[var(--color-surface)] p-8">
      <h2 className="mb-3 text-xl font-semibold">{title}</h2>
      {children}
    </div>
  )
}
