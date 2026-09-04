'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CcgWordmark } from '@/components/brand/logo'
import { primaryNav } from './nav-items'

/**
 * Compact on mobile — mark plus account only. The full navigation lives in the
 * bottom bar on small screens; squeezing it up here is what the acceptance
 * criteria specifically rule out.
 */
export function Header() {
  const pathname = usePathname()

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--color-subtle-border)] bg-[color-mix(in_srgb,var(--color-carbon)_88%,transparent)] backdrop-blur-xl">
      <div
        className="mx-auto flex max-w-[var(--max-content)] items-center gap-6 px-[var(--mobile-gutter)] lg:px-[var(--desktop-gutter)]"
        style={{ paddingTop: 'max(12px, var(--safe-top))', paddingBottom: '12px' }}
      >
        <Link href="/" aria-label="Cool Crypto Games home" className="shrink-0">
          <CcgWordmark size={34} />
        </Link>

        <nav aria-label="Primary" className="ml-4 hidden items-center gap-1 lg:flex">
          {primaryNav.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`rounded-[var(--radius-small)] px-3 py-2 text-sm font-medium transition-colors duration-[var(--duration-fast)] ${
                  active ? 'text-bone' : 'text-[var(--color-muted)] hover:text-bone'
                }`}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {/* Acid is reserved for the primary action, and this is it. */}
          <Link
            href="/games"
            className="hidden rounded-[var(--radius-pill)] bg-acid px-5 py-2.5 text-sm font-bold tracking-[var(--tracking-label)] text-carbon uppercase transition-opacity duration-[var(--duration-fast)] hover:opacity-90 sm:inline-flex"
          >
            Play now
          </Link>
          <Link
            href="/profile"
            aria-label="Profile"
            className="grid size-[var(--tap-target)] place-items-center rounded-full border border-[var(--color-subtle-border)] text-[var(--color-muted)] transition-colors hover:text-bone"
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden className="size-5">
              <circle cx="12" cy="8.5" r="3.5" stroke="currentColor" strokeWidth="1.8" />
              <path d="M5 20a7 7 0 0 1 14 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </Link>
        </div>
      </div>
    </header>
  )
}
