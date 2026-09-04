import { offlineMessage } from '@/lib/streams/layout'
import type { ViewerRender } from '@/lib/streams/types'

/**
 * What a viewer sees on a channel page.
 *
 * The Twitch/Kick shape — game large, facecam inset — is produced two
 * different ways depending on the source, and the difference matters:
 *
 *  - an approved creator's embed arrives already composited by their own
 *    encoder, so it is one video and this component just frames it.
 *  - a native channel is composited here, from a game frame and a camera
 *    track that reach the page separately.
 *
 * Note what the game frame's `allow` attribute does not contain: camera and
 * microphone. A game is untrusted third-party code sharing a page with a
 * broadcaster's webcam, and permission delegation to that frame would be a
 * route to the camera. It never gets one.
 */
export function Theater({
  render,
  cameraSlot,
  gameSlot,
}: {
  render: ViewerRender
  /** Rendered where a facecam belongs. Supplied by the page. */
  cameraSlot?: React.ReactNode
  /** Rendered where the game belongs. */
  gameSlot?: React.ReactNode
}) {
  if (render.mode === 'offline') {
    return (
      <div className="grid aspect-video w-full place-items-center rounded-[var(--radius-large)] border border-[var(--color-subtle-border)] bg-carbon px-6 text-center">
        <p className="max-w-md text-sm text-[var(--color-muted)]">
          {offlineMessage(render.reason)}
        </p>
      </div>
    )
  }

  if (render.mode === 'embed') {
    return (
      <div className="overflow-hidden rounded-[var(--radius-large)] border border-[var(--color-subtle-border)] bg-carbon">
        <iframe
          src={render.url}
          title="Live stream"
          className="aspect-video w-full"
          sandbox="allow-scripts allow-same-origin allow-presentation"
          allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
    )
  }

  const { layout } = render
  const both = layout.showGame && layout.showCamera
  const primaryIsGame = layout.primary === 'game'

  const primary = primaryIsGame ? gameSlot : cameraSlot
  const inset = primaryIsGame ? cameraSlot : gameSlot

  return (
    <div className="relative overflow-hidden rounded-[var(--radius-large)] border border-[var(--color-subtle-border)] bg-carbon">
      <div className="aspect-video w-full">{primary ?? <EmptyPane />}</div>

      {both && (
        // Inset facecam. Bottom-left keeps it clear of the player controls that
        // providers habitually put bottom-right.
        <div className="absolute bottom-4 left-4 w-[28%] min-w-[120px] max-w-[280px] overflow-hidden rounded-[var(--radius-medium)] border border-[var(--color-subtle-border)] shadow-lg">
          <div className="aspect-video w-full bg-[var(--color-graphite)]">
            {inset ?? <EmptyPane />}
          </div>
        </div>
      )}
    </div>
  )
}

function EmptyPane() {
  return (
    <div className="grid h-full w-full place-items-center">
      <p className="text-xs text-[var(--color-muted)]">No source</p>
    </div>
  )
}
