'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { bottomNav } from './nav-items'
import { bottomNavIcons } from './icons'

/**
 * Fixed mobile navigation. Hidden from large screens, which use the header.
 *
 * Height and safe-area padding are tokens rather than magic numbers because
 * the main content reserves exactly this much space at the bottom.
 */
export function BottomNav() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--color-subtle-border)] bg-[color-mix(in_srgb,var(--color-carbon)_94%,transparent)] backdrop-blur-xl lg:hidden"
      style={{ paddingBottom: 'var(--safe-bottom)' }}
    >
      <ul className="mx-auto flex max-w-md items-stretch">
        {bottomNav.map((item) => {
          const Icon = bottomNavIcons[item.href]
          const active =
            item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)

          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex h-[var(--mobile-bottom-nav)] flex-col items-center justify-center gap-1 text-[10px] font-semibold tracking-[var(--tracking-label)] uppercase transition-colors duration-[var(--duration-fast)] ${
                  active ? 'text-accent' : 'text-[var(--color-muted)]'
                }`}
              >
                <Icon className="size-6" />
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
