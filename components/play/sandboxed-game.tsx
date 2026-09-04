'use client'

import { useCallback, useEffect, useRef } from 'react'
import { isFromFrame } from '@/lib/play/protocol'
import {
  SAVE_CHANNEL,
  parseFrameSaveMessage,
  readSave,
  writeSave,
} from '@/lib/play/save-bridge'

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
 */
export function SandboxedGame({ slug, title }: { slug: string; title: string }) {
  const frameRef = useRef<HTMLIFrameElement | null>(null)

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
        post(readSave(slug, window.localStorage))
      } else {
        writeSave(slug, parsed.message.values, window.localStorage)
      }
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [slug, post])

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
