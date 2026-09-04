'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { isFromFrame } from '@/lib/play/protocol'
import {
  SAVE_CHANNEL,
  parseFrameSaveMessage,
  readSave,
  writeSave,
  type SaveValues,
} from '@/lib/play/save-bridge'
import { pickSave } from '@/lib/play/save-sync'

/**
 * Runs a static game build from /games/<slug>/ in a sandbox.
 *
 * The frame gets `allow-scripts` and NOT `allow-same-origin`, so it runs on an
 * opaque origin with no reach into this page's cookies, storage or wallet
 * provider, and `allow` grants it no camera or microphone.
 *
 * That isolation costs the game its own storage, so this component keeps its
 * save for it — see lib/play/save-bridge.ts for why that is a shell job and
 * what it is allowed to hold. A game that never asks simply never gets a
 * message, and nothing here runs.
 *
 * A signed-in player's save lives against their wallet, not against this
 * browser, so signing in on another device resumes where they stopped. The
 * device copy is kept in step as a fallback for playing signed out, and the
 * server copy is loaded before the frame is mounted — a game that has already
 * asked for its save cannot be handed a later one.
 */
export function SandboxedGame({ slug, title }: { slug: string; title: string }) {
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  // The save the frame will be given. Null while it is still being fetched,
  // which is why the frame is not mounted yet.
  const [save, setSave] = useState<SaveValues | null>(null)
  const saveRef = useRef<SaveValues>({})

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const local = readSave(slug, window.localStorage)
      let remote: SaveValues | null = null
      try {
        const res = await fetch(`/api/play/save/${slug}`)
        // 401 is the ordinary signed-out case, not a failure.
        if (res.ok) remote = ((await res.json()) as { values: SaveValues }).values
      } catch {
        // Offline or unreachable. The device copy is a complete fallback.
      }
      if (cancelled) return

      const picked = pickSave({ local, remote })
      saveRef.current = picked.values
      setSave(picked.values)

      // Mirror the chosen save to the device even when the wallet's copy won.
      // Without this, a browser that only ever read the save has no fallback:
      // going offline, or signing out, would leave the player with nothing
      // locally despite having just played here.
      writeSave(slug, picked.values, window.localStorage)

      // The device copy won, so the wallet has not seen this progress yet.
      if (picked.needsUpload) void push(slug, picked.values)
    })()
    return () => {
      cancelled = true
    }
  }, [slug])

  const post = useCallback((values: Record<string, string>) => {
    // The frame is opaque, so there is no origin to target it by. "*" is
    // correct and safe here: the payload is the player's own save, and the
    // message can only reach the document loaded in this frame.
    frameRef.current?.contentWindow?.postMessage(
      { channel: SAVE_CHANNEL, type: 'SAVE_DATA', values },
      '*',
    )
  }, [])

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      // Window identity, not origin. A sandboxed frame reports its origin as
      // the string "null", which any other opaque-origin page in the tab also
      // reports; only the window reference actually identifies the sender.
      if (!isFromFrame(event.source, frameRef.current?.contentWindow)) return

      const parsed = parseFrameSaveMessage(event.data)
      if (!parsed.ok) {
        // Dropped rather than acted on. Logged so a game shipping a malformed
        // message is findable, without letting it change anything.
        if (parsed.reason !== 'wrong_channel') {
          console.warn('[ccg] rejected game save message:', parsed.reason)
        }
        return
      }

      if (parsed.message.type === 'SAVE_LOAD') {
        post(saveRef.current)
      } else {
        saveRef.current = parsed.message.values
        // Both copies, always. The device one so signed-out play keeps working,
        // the wallet one so the next device starts here.
        writeSave(slug, parsed.message.values, window.localStorage)
        void push(slug, parsed.message.values)
      }
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [slug, post])

  // Mounted only once the save is in hand, so the game's first SAVE_LOAD is
  // answered with the wallet's progress rather than with an empty object it
  // would then overwrite.
  if (save === null) {
    return (
      <div className="grid h-full place-items-center">
        <p className="text-sm text-[var(--color-muted)]">Loading your progress…</p>
      </div>
    )
  }

  return (
    <iframe
      ref={frameRef}
      src={`/games/${slug}/index.html`}
      title={title}
      className="h-full w-full border-0"
      sandbox="allow-scripts"
      // No `fullscreen`. The shell already gives the game the whole screen, and
      // a frame that can call requestFullscreen on itself replaces the stage as
      // the fullscreen element — which hides the exit bar and leaves a player
      // with no visible way out of a running match. Signal Brawl asks for it on
      // match start, and did exactly that. Fullscreen belongs to the shell.
      allow="autoplay; gamepad; accelerometer; gyroscope"
      referrerPolicy="no-referrer"
    />
  )
}

/**
 * Stores a save against the wallet.
 *
 * Failures are swallowed on purpose. A game must not stop because a save could
 * not be uploaded — the device copy has already been written, and the next
 * write will carry the same progress.
 */
async function push(slug: string, values: SaveValues): Promise<void> {
  try {
    await fetch(`/api/play/save/${slug}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ values }),
    })
  } catch {
    /* offline, signed out, or rate limited */
  }
}
