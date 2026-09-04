'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export type CameraState =
  | { status: 'idle' }
  | { status: 'requesting' }
  | { status: 'ready'; label: string }
  | { status: 'denied' }
  | { status: 'unavailable'; reason: string }

/**
 * The broadcaster's own camera.
 *
 * Deliberate constraints, because this is a camera pointed at a person:
 *
 *  - it never starts on its own. No effect requests the device on mount; only
 *    an explicit press does, so opening a page can never silently light up a
 *    webcam.
 *  - tracks are stopped on unmount and on the stop control, so the hardware
 *    indicator goes out when the preview does.
 *  - the preview is local. Nothing here uploads or records anything; a frame
 *    reaches CCG only once a distribution provider exists and the broadcaster
 *    has gone on air deliberately.
 */
export function CameraPreview({
  onStateChange,
}: {
  onStateChange?: (state: CameraState) => void
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [state, setState] = useState<CameraState>({ status: 'idle' })

  const update = useCallback(
    (next: CameraState) => {
      setState(next)
      onStateChange?.(next)
    },
    [onStateChange],
  )

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    update({ status: 'idle' })
  }, [update])

  // Release the device if the component goes away while a preview is running.
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [])

  const start = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      update({ status: 'unavailable', reason: 'This browser does not expose camera access.' })
      return
    }

    update({ status: 'requesting' })
    try {
      // Video only. Audio is a separate consent and is not needed to preview a
      // facecam, so it is not requested here.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => {})
      }
      update({ status: 'ready', label: stream.getVideoTracks()[0]?.label || 'Camera' })
    } catch (err) {
      const name = err instanceof DOMException ? err.name : ''
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        update({ status: 'denied' })
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        update({ status: 'unavailable', reason: 'No camera was found on this device.' })
      } else {
        update({ status: 'unavailable', reason: 'The camera could not be started.' })
      }
    }
  }, [update])

  const active = state.status === 'ready'

  return (
    <div>
      <div className="relative overflow-hidden rounded-[var(--radius-medium)] border border-[var(--color-subtle-border)] bg-carbon">
        <video
          ref={videoRef}
          muted
          playsInline
          // Mirrored, which is what every camera preview does — an unmirrored
          // self-view reads as wrong to the person looking at it.
          className={`aspect-video w-full -scale-x-100 object-cover ${active ? '' : 'hidden'}`}
        />

        {!active && (
          <div className="grid aspect-video w-full place-items-center px-6 text-center">
            <p className="text-sm text-[var(--color-muted)]">
              {state.status === 'requesting' && 'Waiting for camera permission…'}
              {state.status === 'idle' && 'Camera off. Nothing is being captured.'}
              {state.status === 'denied' &&
                'Camera permission was refused. Grant it in your browser settings, then try again.'}
              {state.status === 'unavailable' && state.reason}
            </p>
          </div>
        )}

        {active && (
          <span className="absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] bg-carbon/85 px-2.5 py-1 text-[10px] font-bold tracking-[var(--tracking-label)] text-[var(--color-orange)] uppercase backdrop-blur">
            <span aria-hidden className="size-1.5 rounded-full bg-[var(--color-orange)]" />
            Preview only — not broadcasting
          </span>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {active ? (
          <button
            onClick={stop}
            className="min-h-[var(--tap-target)] rounded-[var(--radius-pill)] border border-[var(--color-subtle-border)] px-6 text-sm font-semibold transition-colors hover:border-bone/40"
          >
            Turn camera off
          </button>
        ) : (
          <button
            onClick={start}
            disabled={state.status === 'requesting'}
            className="min-h-[var(--tap-target)] rounded-[var(--radius-pill)] bg-accent-solid px-6 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {state.status === 'requesting' ? 'Requesting…' : 'Turn camera on'}
          </button>
        )}
        {active && <span className="text-xs text-[var(--color-muted)]">{state.label}</span>}
      </div>
    </div>
  )
}
