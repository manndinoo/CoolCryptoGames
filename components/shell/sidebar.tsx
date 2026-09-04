'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { CcgMonogram, CcgWordmark } from '@/components/brand/logo'
import { ChevronIcon, navIcons } from './icons'
import { sidebarNav } from './nav-items'

const STORAGE_KEY = 'ccg:sidebar'

/**
 * Desktop sidebar.
 *
 * Fixed rather than scrolling with the page: navigation that leaves the screen
 * is navigation you have to scroll back up to reach, and the whole reason to
 * spend 248px of width on a permanent map is that it is permanently there.
 *
 * Collapsing keeps the icons and drops the labels. The state persists, and the
 * layout reads it from a `data-sidebar` attribute on <body> rather than through
 * React context — the shell containers are server components, and a CSS custom
 * property is a cheaper way to move them than making the whole tree client-side.
 */
export function Sidebar() {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)

  // The inline script in the document head has already applied the stored
  // state to <body> before first paint. This only syncs React to it, so the
  // toggle renders in the right direction.
  useEffect(() => {
    setCollapsed(document.body.dataset.sidebar === 'collapsed')
  }, [])

  const toggle = useCallback(() => {
    setCollapsed((previous) => {
      const next = !previous
      document.body.dataset.sidebar = next ? 'collapsed' : 'expanded'
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? 'collapsed' : 'expanded')
      } catch {
        // Private mode, or storage disabled. The preference simply does not
        // survive the session, which is not worth failing a click over.
      }
      return next
    })
  }, [])

  return (
    <aside
      aria-label="Primary"
      data-collapsed={collapsed || undefined}
      className="ccg-sidebar fixed top-0 bottom-0 left-0 z-40 hidden flex-col border-r border-[var(--color-subtle-border)] bg-[var(--color-carbon)] lg:flex"
      style={{ width: 'var(--sidebar-w)', paddingTop: 'var(--safe-top)' }}
    >
      {/* ---------------------------------------------------------- brand */}
      <div className="flex h-[76px] shrink-0 items-center px-4">
        <Link
          href="/"
          aria-label="Cool Crypto Games home"
          className="flex min-w-0 items-center transition-opacity duration-[var(--duration-fast)] hover:opacity-80"
        >
          {collapsed ? <CcgMonogram size={30} /> : <CcgWordmark size={30} />}
        </Link>
      </div>

      {/* ------------------------------------------------------------ nav */}
      <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {sidebarNav.map((group) => (
          <div key={group.label} className="mb-5">
            {/* Kept in the DOM when collapsed so the groups still read as
                groups to a screen reader; only visually hidden. */}
            <p
              className={`ccg-side-label px-3 pb-2 text-[10px] font-bold tracking-[var(--tracking-label)] text-[var(--color-muted)] uppercase ${
                collapsed ? 'sr-only' : ''
              }`}
            >
              {group.label}
            </p>

            <ul className="grid gap-0.5">
              {group.items.map((item) => {
                const Icon = navIcons[item.href]
                const active =
                  item.href === '/'
                    ? pathname === '/'
                    : pathname === item.href || pathname.startsWith(`${item.href}/`)

                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      title={collapsed ? item.label : undefined}
                      data-active={active || undefined}
                      className="ccg-side-link group relative flex h-11 items-center gap-3 rounded-[var(--radius-small)] px-3 text-sm font-medium text-[var(--color-muted)] transition-colors duration-[var(--duration-fast)] hover:bg-white/[0.06] hover:text-bone data-[active]:text-bone"
                    >
                      {/* The active marker. A transform, so it animates on the
                          compositor and costs nothing on a low-end phone. */}
                      <span
                        aria-hidden
                        className="ccg-side-marker absolute top-1/2 left-0 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-accent"
                      />
                      {Icon && <Icon className="size-5 shrink-0" />}
                      <span className="ccg-side-text truncate">{item.label}</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* --------------------------------------------------------- action
          Acid is reserved for the primary action and this is it. Placed at the
          foot of a fixed rail so it is on screen on every page — which is the
          honest version of a persistent promotion: the thing it points at is
          free, and pressing it is the thing the site is for. */}
      <div className="shrink-0 border-t border-[var(--color-subtle-border)] p-3">
        <Link
          href="/games"
          className="ccg-side-cta ccg-btn ccg-btn-primary w-full"
        >
          <svg viewBox="0 0 24 24" className="size-4 shrink-0" aria-hidden>
            <path d="M8 5v14l11-7L8 5Z" fill="currentColor" />
          </svg>
          <span className="ccg-side-text">Play now</span>
        </Link>

        <button
          onClick={toggle}
          aria-expanded={!collapsed}
          className="ccg-side-toggle mt-2 flex h-9 w-full items-center gap-3 rounded-[var(--radius-small)] px-3 text-xs font-semibold text-[var(--color-muted)] transition-colors duration-[var(--duration-fast)] hover:bg-white/[0.06] hover:text-bone"
        >
          <ChevronIcon
            className={`size-4 shrink-0 transition-transform duration-[var(--duration-normal)] ${
              collapsed ? 'rotate-180' : ''
            }`}
          />
          <span className="ccg-side-text truncate">Collapse</span>
        </button>
      </div>
    </aside>
  )
}
