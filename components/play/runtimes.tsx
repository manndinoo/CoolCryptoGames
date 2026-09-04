'use client'

import dynamic from 'next/dynamic'
import type { ComponentType } from 'react'

/**
 * Which games this site can actually run, and the component that runs them.
 *
 * A catalogue entry marked `playable` is a claim about the listing; this map is
 * the claim about the code. `PlayGate` mounts nothing for a slug that is not in
 * here, so a listing can never conjure a game that has not shipped.
 *
 * Every runtime is loaded on demand and client-only. Games own a canvas, an
 * animation loop and device storage — none of that survives a server render,
 * and none of it should be in the bundle of a page nobody pressed Play on.
 */
const runtimes: Record<string, ComponentType> = {
  'zero-signal': dynamic(
    () => import('@/components/games/zero-signal/zero-signal-game').then((m) => m.ZeroSignalGame),
    { ssr: false, loading: () => <RuntimeLoading /> },
  ),
}

export function getGameRuntime(slug: string): ComponentType | null {
  return runtimes[slug] ?? null
}

export function hasRuntime(slug: string): boolean {
  return slug in runtimes
}

function RuntimeLoading() {
  return (
    <div className="grid h-full w-full place-items-center bg-carbon">
      <p className="font-display text-[10px] font-bold tracking-[var(--tracking-label)] text-[var(--color-muted)] uppercase">
        Loading
      </p>
    </div>
  )
}
