/**
 * Native fullscreen, across the browsers that have it and the ones that don't.
 *
 * Every call here is fire-and-forget. Fullscreen is a request, not a command:
 * a browser may refuse it because the gesture that allowed it has expired,
 * because a permissions policy forbids it, or — on an iPhone — because
 * `requestFullscreen` does not exist for anything but a video element. None of
 * those is a failure worth reporting to a player who pressed Play, because the
 * stage is a viewport-filling overlay either way and the game runs regardless.
 *
 * The target is always the document element rather than the stage. Two reasons.
 * The request has to be made from inside the click that started the game, and
 * at that instant the stage does not exist yet — its module is still being
 * fetched. And fullscreening the root means the fullscreen element never
 * changes afterwards, so a game inside the frame cannot take it away and leave
 * the player with no way back.
 */

type FullscreenCapableElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void
}

type FullscreenCapableDocument = Document & {
  webkitExitFullscreen?: () => Promise<void> | void
  webkitFullscreenElement?: Element | null
}

export function fullscreenElement(): Element | null {
  if (typeof document === 'undefined') return null
  const doc = document as FullscreenCapableDocument
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null
}

export function fullscreenAvailable(): boolean {
  if (typeof document === 'undefined') return false
  const el = document.documentElement as FullscreenCapableElement
  return typeof el.requestFullscreen === 'function' || typeof el.webkitRequestFullscreen === 'function'
}

/**
 * Must be called synchronously inside a user gesture.
 *
 * Browsers only grant fullscreen while the click that asked for it is still
 * counted as active, and that window is measured in seconds. Awaiting a lazy
 * chunk first — which is what the game shell does — can outrun it on a slow
 * connection, so the request is made at the press and the stage that arrives
 * later simply fills whatever viewport it finds.
 */
export function enterFullscreen(): void {
  if (typeof document === 'undefined') return
  if (fullscreenElement()) return
  const el = document.documentElement as FullscreenCapableElement
  try {
    const result = el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.()
    // A rejected promise with no handler is an unhandled rejection in the
    // console on every refusal, which is noise for an expected outcome.
    void Promise.resolve(result).catch(() => {})
  } catch {
    // Older Safari throws synchronously instead of rejecting.
  }
}

export function exitFullscreen(): void {
  if (typeof document === 'undefined') return
  if (!fullscreenElement()) return
  const doc = document as FullscreenCapableDocument
  try {
    const result = doc.exitFullscreen?.() ?? doc.webkitExitFullscreen?.()
    void Promise.resolve(result).catch(() => {})
  } catch {
    // As above.
  }
}

/** Both spellings of the event, since Safari only ever fired the prefixed one. */
export function onFullscreenChange(handler: () => void): () => void {
  document.addEventListener('fullscreenchange', handler)
  document.addEventListener('webkitfullscreenchange', handler)
  return () => {
    document.removeEventListener('fullscreenchange', handler)
    document.removeEventListener('webkitfullscreenchange', handler)
  }
}
