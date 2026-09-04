'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { isFromFrame, parseGameMessage, PROTOCOL_VERSION } from '@/lib/play/protocol'

export type PlaySession = {
  sessionId: string
  seed: string
  entrypoint: string
  heartbeatIntervalMs: number
}

type Outcome =
  | { state: 'playing' }
  | { state: 'verifying' }
  | { state: 'verified'; score: number }
  | { state: 'rejected'; reasons: string[] }
  | { state: 'error'; message: string }

/**
 * Hosts a game and mediates everything it says.
 *
 * Isolation: the frame is sandboxed with `allow-scripts` and deliberately
 * WITHOUT `allow-same-origin`, so it runs on an opaque origin and cannot read
 * this page's cookies, storage, or the wallet provider. `allow` carries no
 * camera or microphone — a game is untrusted code and must not be able to
 * reach a broadcaster's devices through the page it shares with them.
 *
 * Because the origin is opaque, `event.origin` arrives as the string "null"
 * and cannot identify the sender. Window identity can, which is why every
 * message is checked against the iframe's own contentWindow first.
 */
export function GameFrame({
  session,
  onFinished,
}: {
  session: PlaySession
  onFinished?: (outcome: Outcome) => void
}) {
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const [outcome, setOutcome] = useState<Outcome>({ state: 'playing' })
  const submitted = useRef(false)

  const submit = useCallback(
    async (inputs: { t: number; k: string }[], claimedScore?: number) => {
      // A session yields one score. Guarding here as well as server-side keeps
      // a double-fire from producing a confusing second rejection.
      if (submitted.current) return
      submitted.current = true

      setOutcome({ state: 'verifying' })
      try {
        const res = await fetch('/api/play/submit', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: session.sessionId, inputs, claimedScore }),
        })
        const data = await res.json()

        const next: Outcome = res.ok
          ? { state: 'verified', score: data.score as number }
          : { state: 'rejected', reasons: (data.reasons as string[]) ?? ['unknown'] }

        setOutcome(next)
        onFinished?.(next)
      } catch {
        const next: Outcome = { state: 'error', message: 'Could not reach the server.' }
        setOutcome(next)
        onFinished?.(next)
      }
    },
    [session.sessionId, onFinished],
  )

  // Heartbeats prove the client stayed connected for the whole run. A gap is
  // what exposes a run constructed offline and submitted afterwards.
  useEffect(() => {
    const id = setInterval(() => {
      void fetch('/api/play/heartbeat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: session.sessionId }),
      }).catch(() => {})
    }, session.heartbeatIntervalMs)
    return () => clearInterval(id)
  }, [session.sessionId, session.heartbeatIntervalMs])

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!isFromFrame(event.source, frameRef.current?.contentWindow)) return

      const parsed = parseGameMessage(event.data, { playSessionId: session.sessionId })
      if (!parsed.ok) {
        // Rejected rather than acted on. Logged so a game with a broken build
        // is visible, without letting it change anything.
        console.warn('[ccg] rejected game message:', parsed.reason)
        return
      }

      const msg = parsed.message
      switch (msg.type) {
        case 'GAME_READY':
          // The seed is the server's, issued for this session only.
          frameRef.current?.contentWindow?.postMessage(
            {
              type: 'SESSION_START',
              protocolVersion: PROTOCOL_VERSION,
              seed: session.seed,
              playSessionId: session.sessionId,
            },
            '*',
          )
          break

        case 'SCORE_SUBMIT':
          void submit(msg.inputs, msg.claimedScore)
          break

        case 'REPORT_ERROR':
          console.warn('[ccg] game reported:', msg.message)
          break

        case 'TELEMETRY_BATCH':
        case 'SESSION_END':
          break
      }
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [session.sessionId, session.seed, submit])

  return (
    <div>
      <div className="overflow-hidden rounded-[var(--radius-large)] border border-[var(--color-subtle-border)] bg-carbon">
        <iframe
          ref={frameRef}
          src={session.entrypoint}
          title="Game"
          className="aspect-video w-full"
          // No allow-same-origin: the frame gets an opaque origin and cannot
          // reach this page's cookies, storage, or wallet provider.
          sandbox="allow-scripts"
          // No camera, no microphone, no geolocation. A game gets none of them.
          allow="autoplay; fullscreen; gamepad"
          referrerPolicy="no-referrer"
        />
      </div>

      <div aria-live="polite" className="mt-4">
        {outcome.state === 'verifying' && (
          <p className="text-sm text-[var(--color-muted)]">Verifying your run…</p>
        )}

        {outcome.state === 'verified' && (
          <p className="text-sm text-accent">
            Verified. Score {outcome.score} — the server replayed your inputs and got the
            same result.
          </p>
        )}

        {outcome.state === 'rejected' && (
          <div className="text-sm">
            <p className="text-[var(--color-orange)]">
              This run could not be verified, so it has not been recorded.
            </p>
            <p className="mt-1 text-xs text-[var(--color-muted)]">
              If you think that is wrong, contact support — competition decisions have an
              appeal path.
            </p>
          </div>
        )}

        {outcome.state === 'error' && (
          <p className="text-sm text-[var(--color-orange)]">{outcome.message}</p>
        )}
      </div>
    </div>
  )
}
