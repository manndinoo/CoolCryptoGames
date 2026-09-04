import { describe, expect, it } from 'vitest'
import { resolveLayout, resolveViewerRender } from '@/lib/streams/layout'
import type { StreamChannel } from '@/lib/streams/types'

const HOSTS = ['player.twitch.tv']

function channel(over: Partial<StreamChannel> = {}): StreamChannel {
  return {
    slug: 'c1',
    title: 'Channel',
    broadcaster: 'Approved Creator',
    approved: true,
    state: 'live',
    scheduledFor: null,
    source: { kind: 'external-embed', url: 'https://player.twitch.tv/?channel=ccg' },
    demo: true,
    ...over,
  }
}

function render(over: Partial<StreamChannel> = {}, flags = { ext: true, native: true }) {
  return resolveViewerRender({
    channel: channel(over),
    externalEmbedsEnabled: flags.ext,
    nativeStreamingEnabled: flags.native,
    allowedHosts: HOSTS,
  })
}

describe('resolveViewerRender', () => {
  it('frames an approved, live, allow-listed embed', () => {
    expect(render()).toEqual({
      mode: 'embed',
      url: 'https://player.twitch.tv/?channel=ccg',
    })
  })

  it('refuses an unapproved channel before looking at its source', () => {
    // Anonymous or unapproved broadcasting is excluded outright, so this is
    // not a source with a problem — it is not a source.
    expect(render({ approved: false })).toEqual({ mode: 'offline', reason: 'not_approved' })
  })

  it('never renders a player on the strength of a schedule', () => {
    expect(render({ state: 'scheduled' })).toEqual({ mode: 'offline', reason: 'scheduled' })
    expect(render({ state: 'offline' })).toEqual({ mode: 'offline', reason: 'offline' })
  })

  it('refuses an embed when the feature is off', () => {
    expect(render({}, { ext: false, native: true })).toEqual({
      mode: 'offline',
      reason: 'embeds_disabled',
    })
  })

  it('refuses an embed from an unapproved host', () => {
    expect(
      render({ source: { kind: 'external-embed', url: 'https://evil.example/x' } }),
    ).toEqual({ mode: 'offline', reason: 'host_not_allowed' })
  })

  it('refuses native broadcasting when the feature is off', () => {
    expect(
      render(
        { source: { kind: 'native', layout: 'game-primary', gameSlug: 'zero-signal', hasCamera: true } },
        { ext: true, native: false },
      ),
    ).toEqual({ mode: 'offline', reason: 'native_streaming_disabled' })
  })

  it('renders a native game-plus-camera composition', () => {
    expect(
      render({
        source: { kind: 'native', layout: 'game-primary', gameSlug: 'zero-signal', hasCamera: true },
      }),
    ).toEqual({
      mode: 'native',
      gameSlug: 'zero-signal',
      layout: { showGame: true, showCamera: true, primary: 'game' },
    })
  })

  it('refuses a live channel with no source at all', () => {
    expect(render({ source: null })).toEqual({ mode: 'offline', reason: 'no_source' })
  })

  it('refuses a native channel whose sources have all gone away', () => {
    expect(
      render({ source: { kind: 'native', layout: 'game-primary', gameSlug: null, hasCamera: false } }),
    ).toEqual({ mode: 'offline', reason: 'no_source' })
  })
})

describe('resolveLayout', () => {
  const both = { hasGame: true, hasCamera: true }

  it('puts the game first for game-primary', () => {
    expect(resolveLayout('game-primary', both)).toEqual({
      showGame: true,
      showCamera: true,
      primary: 'game',
    })
  })

  it('puts the camera first for camera-primary', () => {
    expect(resolveLayout('camera-primary', both)).toEqual({
      showGame: true,
      showCamera: true,
      primary: 'camera',
    })
  })

  it('honours single-source layouts', () => {
    expect(resolveLayout('game-only', both)).toEqual({
      showGame: true,
      showCamera: false,
      primary: 'game',
    })
    expect(resolveLayout('camera-only', both)).toEqual({
      showGame: false,
      showCamera: true,
      primary: 'camera',
    })
  })

  it('falls back to the game when the camera is gone', () => {
    // A saved preference outlives the camera it refers to. Better to drop the
    // facecam than render an empty pane where one used to be.
    expect(resolveLayout('camera-primary', { hasGame: true, hasCamera: false })).toEqual({
      showGame: true,
      showCamera: false,
      primary: 'game',
    })
  })

  it('falls back to the camera when the game is gone', () => {
    expect(resolveLayout('game-primary', { hasGame: false, hasCamera: true })).toEqual({
      showGame: false,
      showCamera: true,
      primary: 'camera',
    })
  })

  it('returns null when nothing survives', () => {
    expect(resolveLayout('game-primary', { hasGame: false, hasCamera: false })).toBeNull()
  })
})
