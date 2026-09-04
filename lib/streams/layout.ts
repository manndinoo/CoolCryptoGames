import { checkEmbedUrl } from './embed'
import type {
  OfflineReason,
  ResolvedLayout,
  StreamChannel,
  StreamLayout,
  ViewerRender,
} from './types'

/**
 * Decides what a viewer actually sees.
 *
 * Every path that is not a confirmed, permitted, live source resolves to
 * `offline` with a reason. There is no branch that renders a player on the
 * strength of a schedule or an unchecked URL — "should be live by now" is not
 * evidence that anything is broadcasting.
 */
export function resolveViewerRender(args: {
  channel: StreamChannel
  externalEmbedsEnabled: boolean
  nativeStreamingEnabled: boolean
  allowedHosts?: string[]
}): ViewerRender {
  const { channel, externalEmbedsEnabled, nativeStreamingEnabled, allowedHosts } = args

  // Approval is checked before anything else: an unapproved channel is not a
  // source with a problem, it is not a source at all.
  if (!channel.approved) return offline('not_approved')
  if (channel.state !== 'live') return offline(channel.state === 'scheduled' ? 'scheduled' : 'offline')
  if (!channel.source) return offline('no_source')

  if (channel.source.kind === 'external-embed') {
    if (!externalEmbedsEnabled) return offline('embeds_disabled')
    const check = allowedHosts
      ? checkEmbedUrl(channel.source.url, allowedHosts)
      : checkEmbedUrl(channel.source.url)
    if (!check.allowed) return offline('host_not_allowed')
    return { mode: 'embed', url: check.url }
  }

  if (!nativeStreamingEnabled) return offline('native_streaming_disabled')

  const layout = resolveLayout(channel.source.layout, {
    hasGame: Boolean(channel.source.gameSlug),
    hasCamera: channel.source.hasCamera,
  })
  if (!layout) return offline('no_source')

  return { mode: 'native', layout, gameSlug: channel.source.gameSlug }
}

/**
 * Reconciles the requested composition with what the channel actually has.
 *
 * A broadcaster's saved preference can outlive the thing it refers to — the
 * camera gets unplugged, the game is pulled from the catalogue. Falling back
 * to whatever source survives is better than rendering an empty pane where a
 * facecam used to be, and returning null when nothing survives is what stops
 * a "live" channel showing two blank boxes.
 */
export function resolveLayout(
  requested: StreamLayout,
  available: { hasGame: boolean; hasCamera: boolean },
): ResolvedLayout | null {
  const { hasGame, hasCamera } = available
  if (!hasGame && !hasCamera) return null

  // Only one source survives: render it, whatever was requested.
  if (!hasCamera) return { showGame: true, showCamera: false, primary: 'game' }
  if (!hasGame) return { showGame: false, showCamera: true, primary: 'camera' }

  const cameraPrimary = requested === 'camera-primary' || requested === 'camera-only'
  return {
    showGame: requested !== 'camera-only',
    showCamera: requested !== 'game-only',
    primary: cameraPrimary ? 'camera' : 'game',
  }
}

const OFFLINE_COPY: Record<OfflineReason, string> = {
  scheduled: 'Not broadcasting yet. This slot is scheduled, not live.',
  offline: 'Offline.',
  not_approved: 'This channel is not approved to broadcast.',
  no_source: 'No video source is attached to this channel.',
  embeds_disabled: 'External stream embeds are disabled in this environment.',
  host_not_allowed: 'This stream is hosted somewhere CCG has not approved.',
  native_streaming_disabled:
    'CCG-hosted broadcasting is not enabled yet. Approved creators can stream through their own provider in the meantime.',
}

export function offlineMessage(reason: OfflineReason): string {
  return OFFLINE_COPY[reason]
}

function offline(reason: OfflineReason): ViewerRender {
  return { mode: 'offline', reason }
}
