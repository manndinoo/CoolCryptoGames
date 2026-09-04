'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useWalletAuth } from '@/components/play/use-wallet-auth'
import { UsernameSetup } from '@/components/play/username-setup'
import { WalletSheet } from '@/components/play/wallet-sheet'
import { StatusPill } from '@/components/ui/badges'

type AccountRequest = {
  id: string
  kind: 'data_export' | 'deletion'
  status: string
  note: string | null
  createdAt: string
  resolvedAt: string | null
  resolution: string | null
}

/**
 * Account settings.
 *
 * Every control here does something. There is no toggle standing in for a
 * feature that does not exist, and no "coming soon" switch a player could flip
 * and believe they had changed something — a setting that silently does
 * nothing is worse than an absent one, because it produces false confidence
 * about how your data is handled.
 */
export function SettingsView() {
  const { state, signIn, signOut, setUsername, connected } = useWalletAuth()
  const [addressShown, setAddressShown] = useState(false)
  const [requests, setRequests] = useState<AccountRequest[] | null>(null)
  const [busy, setBusy] = useState<null | 'export' | 'deletion'>(null)
  const [message, setMessage] = useState<string | null>(null)

  const signedIn = state.status === 'signed-in'

  const loadRequests = useCallback(async () => {
    try {
      const res = await fetch('/api/account/requests')
      if (!res.ok) return
      const data = (await res.json()) as { requests: AccountRequest[] }
      setRequests(data.requests)
    } catch {
      // A failed read leaves the list unknown rather than claiming it is empty.
    }
  }, [])

  useEffect(() => {
    if (signedIn) void loadRequests()
  }, [signedIn, loadRequests])

  async function downloadData() {
    setBusy('export')
    setMessage(null)
    try {
      const res = await fetch('/api/account/data')
      if (!res.ok) {
        setMessage('That could not be produced right now. Nothing has changed.')
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'ccg-account-data.json'
      a.click()
      // Revoked on the next frame: a synchronous revoke can beat the click.
      setTimeout(() => URL.revokeObjectURL(url), 0)
      setMessage('Downloaded.')
    } catch {
      setMessage('That could not be produced right now. Nothing has changed.')
    } finally {
      setBusy(null)
    }
  }

  async function requestDeletion() {
    setBusy('deletion')
    setMessage(null)
    try {
      const res = await fetch('/api/account/requests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'deletion' }),
      })
      const data = (await res.json().catch(() => ({}))) as { alreadyOpen?: boolean }
      if (!res.ok) {
        setMessage('That could not be recorded right now. Nothing has changed.')
        return
      }
      setMessage(
        data.alreadyOpen
          ? 'You already have a deletion request open. It has not been duplicated.'
          : 'Recorded. A person will review it.',
      )
      await loadRequests()
    } catch {
      setMessage('That could not be recorded right now. Nothing has changed.')
    } finally {
      setBusy(null)
    }
  }

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

  if (!signedIn) {
    return (
      <div className="mt-[var(--spacing-6)]">
        <p className="mb-[var(--spacing-5)] max-w-lg text-[var(--color-muted)]">
          Settings belong to an account, and an account is a wallet that has signed in.
          Connect one to see what is stored about you and to change it.
        </p>
        <WalletSheet state={state} onSignIn={signIn} connected={connected} />
        <div className="ccg-surface mt-[var(--spacing-5)] rounded-[var(--radius-large)] p-[var(--spacing-5)]">
          <h2 className="text-[10px] font-bold tracking-[var(--tracking-label)] text-[var(--color-muted)] uppercase">
            What is stored, whether or not you sign in
          </h2>
          <DataPolicy />
        </div>
      </div>
    )
  }

  const openDeletion = requests?.find((r) => r.kind === 'deletion' && r.status === 'open')

  return (
    <div className="mt-[var(--spacing-6)] grid gap-[var(--spacing-4)]">
      {/* ------------------------------------------------------- identity */}
      <Panel title="Player name">
        <p className="mt-1 font-display text-2xl font-bold tracking-[var(--tracking-display)]">
          {state.username}
        </p>
        <p className="mt-2 max-w-lg text-sm text-[var(--color-muted)]">
          This is the only name other players see — on leaderboards, in tournament
          standings and in stream chat. Your wallet address is never shown beside it.
        </p>
        <p className="mt-3 max-w-lg text-sm text-[var(--color-muted)]">
          A name cannot be changed from here. Other players learn to recognise it, and
          quietly reassigning names is how impersonation on a leaderboard starts. If you
          need a change, raise it below and a person will handle it.
        </p>
      </Panel>

      {/* --------------------------------------------------------- wallet */}
      <Panel title="Connected wallet">
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <p className="font-mono text-sm break-all">
            {addressShown ? state.wallet : '••••••••••••••••••••••••••••••••'}
          </p>
          <button
            onClick={() => setAddressShown((v) => !v)}
            aria-expanded={addressShown}
            className="shrink-0 text-xs font-semibold text-[var(--color-muted)] transition-colors hover:text-bone"
          >
            {addressShown ? 'Hide' : 'Show address'}
          </button>
        </div>
        <p className="mt-3 max-w-lg text-sm text-[var(--color-muted)]">
          Signing in proved you control this key. It granted CCG no custody, no token
          allowance, and no permission over anything the wallet holds. Playing never
          requires a balance, a token, an NFT, a transaction or a gas fee.
        </p>
        <button
          onClick={signOut}
          className="mt-[var(--spacing-5)] inline-flex min-h-[var(--tap-target)] items-center rounded-[var(--radius-pill)] border border-[var(--color-subtle-border)] px-6 text-sm font-semibold transition-colors hover:border-bone/40"
        >
          Sign out
        </button>
      </Panel>

      {/* ----------------------------------------------------------- data */}
      <Panel title="Your data">
        <DataPolicy />
        <div className="mt-[var(--spacing-5)] flex flex-wrap gap-3">
          <button
            onClick={downloadData}
            disabled={busy !== null}
            className="inline-flex min-h-[var(--tap-target)] items-center rounded-[var(--radius-pill)] border border-[var(--color-subtle-border)] px-6 text-sm font-semibold transition-colors hover:border-bone/40 disabled:opacity-50"
          >
            {busy === 'export' ? 'Preparing…' : 'Download my data'}
          </button>
        </div>
        {message && (
          <p className="mt-3 text-sm text-[var(--color-muted)]" role="status">
            {message}
          </p>
        )}
      </Panel>

      {/* ------------------------------------------------------- deletion */}
      <Panel title="Delete this account">
        <p className="mt-1 max-w-lg text-sm text-[var(--color-muted)]">
          Deletion is reviewed by a person rather than run instantly. The device and
          network links a delete would remove are the same records used to investigate
          organised cheating, so an account under review cannot erase them on demand.
          Saying that plainly is better than a button that quietly does not apply to
          everyone.
        </p>
        <p className="mt-3 max-w-lg text-sm text-[var(--color-muted)]">
          Verified results already published stay attributed to your player name unless
          the review removes them too.
        </p>

        {openDeletion ? (
          <p className="mt-[var(--spacing-5)] flex flex-wrap items-center gap-3 text-sm text-[var(--color-muted)]">
            <StatusPill tone="alert">Request open</StatusPill>
            Raised {new Date(openDeletion.createdAt).toLocaleDateString('en-GB')}.
          </p>
        ) : (
          <button
            onClick={requestDeletion}
            disabled={busy !== null}
            className="mt-[var(--spacing-5)] inline-flex min-h-[var(--tap-target)] items-center rounded-[var(--radius-pill)] border border-[color-mix(in_srgb,var(--color-orange)_60%,transparent)] px-6 text-sm font-semibold text-[var(--color-orange)] transition-colors hover:border-[var(--color-orange)] disabled:opacity-50"
          >
            {busy === 'deletion' ? 'Recording…' : 'Request deletion'}
          </button>
        )}
      </Panel>

      {/* ------------------------------------------------------- requests */}
      <Panel title="Requests and appeals">
        {requests === null ? (
          <p className="mt-1 text-sm text-[var(--color-muted)]">Loading…</p>
        ) : requests.length === 0 ? (
          <p className="mt-1 max-w-lg text-sm text-[var(--color-muted)]">
            Nothing open. Any decision that affects competition — a held result, a
            rejected score, a restriction on this account — can be appealed to a person,
            and what you raise appears here with its outcome.
          </p>
        ) : (
          <ul className="mt-1 divide-y divide-[var(--color-subtle-border)]">
            {requests.map((request) => (
              <li key={request.id} className="py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <StatusPill tone={request.status === 'open' ? 'alert' : 'neutral'}>
                    {request.status}
                  </StatusPill>
                  <span className="text-sm font-medium">
                    {request.kind === 'deletion' ? 'Account deletion' : 'Data export'}
                  </span>
                  <span className="text-xs text-[var(--color-muted)]">
                    {new Date(request.createdAt).toLocaleDateString('en-GB')}
                  </span>
                </div>
                {request.resolution && (
                  <p className="mt-2 text-sm text-[var(--color-muted)]">{request.resolution}</p>
                )}
              </li>
            ))}
          </ul>
        )}
        <Link
          href="/profile"
          className="mt-[var(--spacing-5)] inline-flex min-h-[var(--tap-target)] items-center rounded-[var(--radius-pill)] border border-[var(--color-subtle-border)] px-6 text-sm font-semibold transition-colors hover:border-bone/40"
        >
          Back to profile
        </Link>
      </Panel>
    </div>
  )
}

/**
 * What is held and why, in the same words on the signed-in and signed-out
 * views. Someone deciding whether to connect a wallet needs this before they
 * connect, not after.
 */
function DataPolicy() {
  return (
    <dl className="mt-1 grid gap-4 text-sm">
      <Item term="Wallet address">
        Held as your account key. Shown only back to you, on this page, and never on any
        public surface.
      </Item>
      <Item term="Device">
        A hash of a handful of browser and hardware properties, mixed with a secret the
        browser never sees. It cannot be reversed into a device, and it is not a
        perfect identifier — switching browsers changes it. It exists to make running
        many accounts from one machine costly, not impossible.
      </Item>
      <Item term="Network address">
        Never stored as an address. Kept as a hash plus a truncated form — a /24 for
        IPv4, a /64 for IPv6 — so a restriction can be reasoned about without holding
        where you connect from.
      </Item>
      <Item term="Play and results">
        Your input logs are replayed on the server to produce a score. What is kept is
        the run&apos;s outcome, its duration, and whether it was accepted.
      </Item>
      <Item term="Not collected">
        No email, no phone number, no name, no third-party analytics or advertising
        identifiers, and no market or portfolio data from your wallet.
      </Item>
    </dl>
  )
}

function Item({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] font-bold tracking-[var(--tracking-label)] text-[var(--color-muted)] uppercase">
        {term}
      </dt>
      <dd className="mt-1 max-w-lg text-[var(--color-muted)]">{children}</dd>
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="ccg-surface rounded-[var(--radius-large)] p-[var(--spacing-5)]">
      <h2 className="text-[10px] font-bold tracking-[var(--tracking-label)] text-[var(--color-muted)] uppercase">
        {title}
      </h2>
      {children}
    </section>
  )
}
