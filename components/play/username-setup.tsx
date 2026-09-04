'use client'

import { useEffect, useState } from 'react'
import {
  MAX_USERNAME_LENGTH,
  MIN_USERNAME_LENGTH,
  usernameRejectionMessage,
  type UsernameRejection,
} from '@/lib/identity/username'

type Availability =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'free' }
  | { state: 'taken' }
  | { state: 'invalid'; reason: UsernameRejection }

/**
 * Choosing a public name, shown once after a wallet's first sign-in.
 *
 * The name is what appears on leaderboards, in chat and on a profile. The
 * wallet address appears on none of them — an address exposes a balance, a
 * counterparty history and every other account it has touched, which is far
 * more than a player agrees to publish by entering a tournament.
 */
export function UsernameSetup({ onDone }: { onDone: (username: string) => void }) {
  const [name, setName] = useState('')
  const [availability, setAvailability] = useState<Availability>({ state: 'idle' })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Debounced availability check. Advisory only — the unique index decides.
  useEffect(() => {
    if (name.trim().length < MIN_USERNAME_LENGTH) {
      setAvailability({ state: 'idle' })
      return
    }

    setAvailability({ state: 'checking' })
    const id = setTimeout(async () => {
      try {
        const res = await fetch(`/api/auth/username?name=${encodeURIComponent(name)}`)
        const data = await res.json()
        if (data.available) setAvailability({ state: 'free' })
        else if (data.reason === 'taken') setAvailability({ state: 'taken' })
        else setAvailability({ state: 'invalid', reason: data.reason })
      } catch {
        setAvailability({ state: 'idle' })
      }
    }, 350)

    return () => clearTimeout(id)
  }, [name])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/username', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: name }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(
          data.reason === 'taken'
            ? 'That name was just taken. Try another.'
            : (usernameRejectionMessage(data.reason as UsernameRejection) ??
              'That name could not be used.'),
        )
        return
      }
      onDone(data.username as string)
    } catch {
      setError('Could not save that name. Check your connection.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="ccg-surface rounded-[var(--radius-large)] p-[var(--spacing-6)]">
      <h3 className="font-display text-xl font-bold tracking-[var(--tracking-display)]">
        Choose your player name
      </h3>

      <p className="mt-3 max-w-md text-sm text-[var(--color-muted)]">
        This is the name shown on leaderboards, in chat, and on your profile.
      </p>

      <p className="mt-[var(--spacing-4)] max-w-md rounded-[var(--radius-medium)] border border-[var(--color-subtle-border)] bg-carbon p-4 text-sm">
        Your wallet address is never shown publicly. Only you can see which wallet your
        account is connected to.
      </p>

      <form onSubmit={submit} className="mt-[var(--spacing-5)] max-w-md">
        <label htmlFor="username" className="sr-only">
          Player name
        </label>
        <input
          id="username"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={MAX_USERNAME_LENGTH}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="ReflexKing"
          className="min-h-[var(--tap-target)] w-full rounded-[var(--radius-pill)] border border-[var(--color-subtle-border)] bg-carbon px-5 text-sm outline-none placeholder:text-[var(--color-muted)] focus-visible:border-[var(--color-strong-border)]"
        />

        <p className="mt-2 min-h-5 text-xs">
          {availability.state === 'checking' && (
            <span className="text-[var(--color-muted)]">Checking…</span>
          )}
          {availability.state === 'free' && <span className="text-acid">Available</span>}
          {availability.state === 'taken' && (
            <span className="text-[var(--color-orange)]">Already taken</span>
          )}
          {availability.state === 'invalid' && (
            <span className="text-[var(--color-orange)]">
              {usernameRejectionMessage(availability.reason)}
            </span>
          )}
          {availability.state === 'idle' && (
            <span className="text-[var(--color-muted)]">
              {MIN_USERNAME_LENGTH}–{MAX_USERNAME_LENGTH} characters. Letters, numbers and
              underscores.
            </span>
          )}
        </p>

        <button
          type="submit"
          disabled={submitting || availability.state !== 'free'}
          className="mt-[var(--spacing-4)] inline-flex min-h-[var(--tap-target)] items-center rounded-[var(--radius-pill)] bg-acid px-7 text-sm font-bold tracking-[var(--tracking-label)] text-carbon uppercase transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:bg-[var(--color-graphite-raised)] disabled:text-[var(--color-muted)]"
        >
          {submitting ? 'Saving…' : 'Claim name'}
        </button>

        {error && <p className="mt-3 text-sm text-[var(--color-orange)]">{error}</p>}
      </form>
    </div>
  )
}
