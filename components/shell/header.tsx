'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CcgWordmark } from '@/components/brand/logo'
import { sidebarNav } from './nav-items'

/**
 * The name of the section you are in.
 *
 * Matched longest-first so `/games/zero-signal` resolves to Games rather than
 * to Home, which every path would otherwise match on its leading slash.
 */
function sectionLabel(pathname: string): string {
  if (pathname === '/') return 'Home'
  const items = sidebarNav.flatMap((group) => group.items).filter((item) => item.href !== '/')
  const match = items
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]
  return match?.label ?? ''
}

/**
 * Top bar.
 *
 * Two different jobs at two sizes. On mobile it is the whole of the site's
 * identity and its primary action, because the bottom bar only has room for
 * four destinations. On desktop the sidebar owns both the mark and the
 * navigation, so this shrinks to the account control — repeating the rail's
 * links along the top would be two maps of the same site disagreeing about
 * which one you are meant to read.
 */
export function Header() {
  const pathname = usePathname()
  const onProfile = pathname === '/profile' || pathname.startsWith('/profile/')
  const section = sectionLabel(pathname)

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--color-subtle-border)] bg-[color-mix(in_srgb,var(--color-carbon)_82%,transparent)] backdrop-blur-xl">
      <div
        className="mx-auto flex max-w-[var(--max-content)] items-center gap-4 px-[var(--mobile-gutter)] lg:px-[var(--desktop-gutter)]"
        style={{ paddingTop: 'max(12px, var(--safe-top))', paddingBottom: '12px' }}
      >
        {/* The rail carries the mark once the rail exists. */}
        <Link href="/" aria-label="Cool Crypto Games home" className="shrink-0 lg:hidden">
          <CcgWordmark size={34} />
        </Link>

        {/* Wayfinding, desktop only. The rail already highlights where you
            are; this repeats it at the top of the reading column, which is
            where the eye lands after a navigation rather than at the far left
            edge of the window. */}
        {section && (
          <span
            key={section}
            className="ccg-reveal hidden font-display text-sm font-bold tracking-[var(--tracking-label)] text-[var(--color-muted)] uppercase lg:block"
          >
            {section}
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {/* Acid is reserved for the primary action. On desktop that button
              lives at the foot of the rail, where it is on screen on every
              page; showing it twice would spend the reserved colour twice. */}
          <Link
            href="/games"
            className="hidden rounded-[var(--radius-pill)] bg-acid px-5 py-2.5 text-sm font-bold tracking-[var(--tracking-label)] text-carbon uppercase transition-transform duration-[var(--duration-fast)] hover:scale-[1.03] active:scale-[0.98] sm:inline-flex lg:hidden"
          >
            Play now
          </Link>

          <Link
            href="/profile"
            aria-label="Profile"
            aria-current={onProfile ? 'page' : undefined}
            className={`grid size-[var(--tap-target)] place-items-center rounded-full border transition-colors duration-[var(--duration-fast)] ${
              onProfile
                ? 'border-[var(--color-strong-border)] text-bone'
                : 'border-[var(--color-subtle-border)] text-[var(--color-muted)] hover:border-bone/40 hover:text-bone'
            }`}
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden className="size-5">
              <circle cx="12" cy="8.5" r="3.5" stroke="currentColor" strokeWidth="1.8" />
              <path
                d="M5 20a7 7 0 0 1 14 0"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </Link>
        </div>
      </div>
    </header>
  )
}
