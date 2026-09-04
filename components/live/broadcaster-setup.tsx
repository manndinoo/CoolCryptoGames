'use client'

import { useState } from 'react'
import { CameraPreview, type CameraState } from './camera-preview'
import { Theater } from './theater'
import { resolveLayout } from '@/lib/streams/layout'
import type { StreamLayout } from '@/lib/streams/types'

const LAYOUTS: { value: StreamLayout; label: string }[] = [
  { value: 'game-primary', label: 'Game + facecam' },
  { value: 'camera-primary', label: 'Camera + game inset' },
  { value: 'game-only', label: 'Game only' },
  { value: 'camera-only', label: 'Camera only' },
]

/**
 * Layout picker with a live preview of the composition.
 *
 * The preview runs the same `resolveLayout` the viewer page uses, so what a
 * broadcaster arranges here is what a viewer would get — including the
 * fallbacks. Choosing a camera layout with no camera attached visibly collapses
 * to the game, rather than looking fine here and breaking on air.
 */
export function BroadcasterSetup() {
  const [layout, setLayout] = useState<StreamLayout>('game-primary')
  const [camera, setCamera] = useState<CameraState>({ status: 'idle' })

  const hasCamera = camera.status === 'ready'
  const resolved = resolveLayout(layout, { hasGame: true, hasCamera })

  return (
    <div>
      <fieldset>
        <legend className="mb-3 text-[10px] font-bold tracking-[var(--tracking-label)] text-[var(--color-muted)] uppercase">
          Layout
        </legend>
        <div className="flex flex-wrap gap-2">
          {LAYOUTS.map((option) => (
            <button
              key={option.value}
              onClick={() => setLayout(option.value)}
              aria-pressed={layout === option.value}
              className={`min-h-[var(--tap-target)] rounded-[var(--radius-pill)] border px-4 text-xs font-semibold transition-colors ${
                layout === option.value
                  ? 'border-[var(--color-strong-border)] text-acid'
                  : 'border-[var(--color-subtle-border)] text-[var(--color-muted)] hover:text-bone'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="mt-[var(--spacing-5)] grid gap-[var(--spacing-5)] lg:grid-cols-2 lg:items-start">
       <div>
        <p className="mb-3 text-[10px] font-bold tracking-[var(--tracking-label)] text-[var(--color-muted)] uppercase">
          Viewer preview
        </p>
        <Theater
          render={
            resolved
              ? { mode: 'native', layout: resolved, gameSlug: null }
              : { mode: 'offline', reason: 'no_source' }
          }
          gameSlot={
            <div className="grid h-full w-full place-items-center bg-[var(--color-graphite)]">
              <p className="text-xs text-[var(--color-muted)]">Game frame</p>
            </div>
          }
          cameraSlot={
            hasCamera ? (
              <div className="grid h-full w-full place-items-center bg-[var(--color-graphite-raised)]">
                <p className="text-xs text-[var(--color-muted)]">Your camera</p>
              </div>
            ) : undefined
          }
        />
        {!hasCamera && layout !== 'game-only' && (
          <p className="mt-3 text-xs text-[var(--color-orange)]">
            No camera attached, so this layout falls back to the game. Turn the camera on
            to see the facecam composition.
          </p>
        )}
       </div>

       <div>
        <p className="mb-3 text-[10px] font-bold tracking-[var(--tracking-label)] text-[var(--color-muted)] uppercase">
          Camera
        </p>
        <CameraPreview onStateChange={setCamera} />
       </div>
      </div>
    </div>
  )
}
