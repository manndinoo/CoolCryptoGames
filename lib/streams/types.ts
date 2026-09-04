/**
 * Stream sources.
 *
 * Two genuinely different things wear the word "streaming" here, and keeping
 * them apart is what lets Phase 1 ship something real:
 *
 *  - `external-embed` — an approved creator broadcasts through their own
 *    provider. Their encoder (OBS and friends) has already composited game
 *    and facecam into a single video before it reaches us, so a
 *    camera-over-game stream needs nothing from CCG beyond framing it. This
 *    is the founding capability: "official channel plus approved embedded
 *    creators".
 *
 *  - `native` — CCG captures the game frame and the player's camera itself
 *    and distributes them. This is the platform-phase capability in the
 *    streaming rollout, it needs a provider account and a full
 *    trust-and-safety operation, and it stays behind FEATURE_NATIVE_STREAMING.
 *
 * The layout below describes both, so a native channel's composition is
 * already modelled and rendered even while distribution is switched off.
 */

export type StreamLayout = 'game-primary' | 'camera-primary' | 'game-only' | 'camera-only'

export type StreamSource =
  | { kind: 'external-embed'; url: string }
  | {
      kind: 'native'
      layout: StreamLayout
      /** The game being played, if the channel is playing one. */
      gameSlug: string | null
      /** Whether the broadcaster has a camera attached to this channel. */
      hasCamera: boolean
    }

export type StreamChannel = {
  slug: string
  title: string
  /** Display name of the approved broadcaster. Anonymous streaming is excluded. */
  broadcaster: string
  /** Pre-approval is the moderation model for the founding phase. */
  approved: boolean
  state: 'live' | 'scheduled' | 'offline'
  scheduledFor: string | null
  source: StreamSource | null
  demo: boolean
}

export type ResolvedLayout = {
  showGame: boolean
  showCamera: boolean
  primary: 'game' | 'camera'
}

export type OfflineReason =
  | 'scheduled'
  | 'offline'
  | 'not_approved'
  | 'no_source'
  | 'embeds_disabled'
  | 'host_not_allowed'
  | 'native_streaming_disabled'

export type ViewerRender =
  | { mode: 'embed'; url: string }
  | { mode: 'native'; layout: ResolvedLayout; gameSlug: string | null }
  | { mode: 'offline'; reason: OfflineReason }
