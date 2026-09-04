'use client'

import { usePathname } from 'next/navigation'

/**
 * Replays the entrance animation on every navigation.
 *
 * The `key` is the point: React tears down the old subtree and mounts a new
 * one, which is what restarts a CSS animation. Without it the animation runs
 * once on first load and every subsequent page appears instantly, which reads
 * as two different websites.
 *
 * Chosen over a fade-out/fade-in pair deliberately. An exit animation means
 * holding the old page on screen after the user has asked for a new one —
 * time spent waiting that the interface invented. This only animates the
 * arrival, so navigation is never slower than the network made it.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  return (
    <div key={pathname} className="ccg-reveal">
      {children}
    </div>
  )
}
