'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useWalletAuth } from '@/components/play/use-wallet-auth'
import { StatusPill } from '@/components/ui/badges'
import { chatDenyMessage, MAX_MESSAGE_LENGTH, type ChatDenyReason } from '@/lib/chat/rules'

type ChatMessage = { id: string; handle: string; body: string; at: string }

const POLL_MS = 4_000

/**
 * Channel chat.
 *
 * Reading is open to everyone — no wallet, no account. Posting needs a wallet
 * session, so every message carries an identity that can be muted or removed.
 * That is the difference between open chat, which this is, and anonymous chat,
 * which the founding product does not offer.
 *
 * Polling rather than a socket: there is no realtime infrastructure yet, and a
 * four-second poll is honest about that instead of implying a live pipe that
 * does not exist. It swaps out for a subscription without the surface changing.
 */
export function Chat({ channelSlug, enabled }: { channelSlug: string; enabled: boolean }) {
  const { state } = useWalletAuth()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [reachable, setReachable] = useState(true)
  const listRef = useRef<HTMLDivElement | null>(null)

  const signedIn = state.status === 'signed-in'
  const needsName = state.status === 'needs-username'

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/live/${channelSlug}/chat`)
      if (!res.ok) {
        setReachable(false)
        return
      }
      const data = (await res.json()) as { messages: ChatMessage[] }
      setMessages(data.messages)
      setReachable(true)
    } catch {
      setReachable(false)
    }
  }, [channelSlug])

  useEffect(() => {
    if (!enabled) return
    void load()
    const id = setInterval(load, POLL_MS)
    return () => clearInterval(id)
  }, [enabled, load])

  // Keep the newest message in view, the way every chat does.
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (!draft.trim() || sending) return

    setSending(true)
    setError(null)
    try {
      const res = await fetch(`/api/live/${channelSlug}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: draft }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(chatDenyMessage(data.reason as ChatDenyReason) ?? 'Message not sent.')
        return
      }
      setDraft('')
      setMessages((prev) => [...prev, data.message as ChatMessage])
    } catch {
      setError('Message not sent. Check your connection.')
    } finally {
      setSending(false)
    }
  }

  const remaining = MAX_MESSAGE_LENGTH - draft.length

  return (
    <aside className="ccg-surface flex h-[420px] flex-col rounded-[var(--radius-large)] p-[var(--spacing-4)] lg:h-[560px]">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="font-display text-xs font-bold tracking-[var(--tracking-label)] uppercase">
          Chat
        </h2>
        <StatusPill>{enabled ? 'Open' : 'Off'}</StatusPill>
      </div>

      <div
        ref={listRef}
        className="flex-1 overflow-y-auto rounded-[var(--radius-medium)] border border-[var(--color-subtle-border)] bg-carbon p-3"
        aria-live="polite"
        aria-label="Chat messages"
      >
        {!enabled ? (
          <Empty>Chat is off for this channel.</Empty>
        ) : !reachable ? (
          <Empty>
            Chat is unavailable. The message store is not reachable from this environment.
          </Empty>
        ) : messages.length === 0 ? (
          <Empty>No messages yet. Anyone with a wallet can start.</Empty>
        ) : (
          <ul className="grid gap-2 text-sm">
            {messages.map((m) => (
              <li key={m.id} className="break-words">
                <span className="font-mono text-xs text-accent">{m.handle}</span>{' '}
                {/* Rendered as text, never as markup. */}
                <span className="text-bone/90">{m.body}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {enabled && (
        <div className="mt-3">
          {signedIn ? (
            <form onSubmit={send} className="grid gap-2">
              <label htmlFor="chat-input" className="sr-only">
                Send a message
              </label>
              <div className="flex gap-2">
                <input
                  id="chat-input"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  maxLength={MAX_MESSAGE_LENGTH}
                  placeholder="Say something"
                  className="min-h-[var(--tap-target)] flex-1 rounded-[var(--radius-pill)] border border-[var(--color-subtle-border)] bg-carbon px-4 text-sm outline-none placeholder:text-[var(--color-muted)] focus-visible:border-[var(--color-strong-border)]"
                />
                <button
                  type="submit"
                  disabled={sending || draft.trim().length === 0}
                  className="min-h-[var(--tap-target)] shrink-0 rounded-[var(--radius-pill)] bg-accent-solid px-5 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  Send
                </button>
              </div>

              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="text-[var(--color-orange)]">{error}</span>
                {remaining < 80 && (
                  <span className="shrink-0 text-[var(--color-muted)]">{remaining}</span>
                )}
              </div>
            </form>
          ) : (
            <div className="rounded-[var(--radius-medium)] border border-[var(--color-subtle-border)] p-3">
              <p className="text-xs text-[var(--color-muted)]">
                {needsName
                  ? 'Choose a player name to post. Chat shows your name, never your wallet address.'
                  : 'Reading chat is open to everyone. Connect a wallet to post — messages are attributed, so anonymous chat is not offered.'}
              </p>
              <Link
                href="/profile"
                className="mt-3 inline-flex min-h-[var(--tap-target)] items-center rounded-[var(--radius-pill)] border border-[var(--color-subtle-border)] px-5 text-xs font-semibold transition-colors hover:border-bone/40"
              >
                {needsName ? 'Choose a name' : 'Connect a wallet'}
              </Link>
            </div>
          )}
        </div>
      )}
    </aside>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid h-full place-items-center px-4 text-center">
      <p className="text-xs text-[var(--color-muted)]">{children}</p>
    </div>
  )
}
