import Link from 'next/link'
import { CcgMonogram } from '@/components/brand/logo'
import { site } from '@/site.config'

export function Footer() {
  return (
    <footer className="mt-[var(--spacing-8)] border-t border-[var(--color-subtle-border)]">
      <div className="mx-auto max-w-[var(--max-content)] px-[var(--mobile-gutter)] py-[var(--spacing-7)] lg:px-[var(--desktop-gutter)]">
        <div className="flex flex-wrap items-start justify-between gap-8">
          <div className="max-w-xs">
            <CcgMonogram size={30} />
            <p className="mt-4 text-sm text-[var(--color-muted)]">{site.productLine}</p>
          </div>

          <nav aria-label="Footer" className="flex flex-wrap gap-x-10 gap-y-3 text-sm">
            {[
              { href: '/games', label: 'Games' },
              { href: '/tournaments', label: 'Tournaments' },
              { href: '/developers', label: 'Developers' },
              { href: '/leaderboards', label: 'Leaderboards' },
              { href: '/settings', label: 'Settings' },
            ].map((l) => (
              <Link key={l.href} href={l.href} className="text-[var(--color-muted)] hover:text-bone">
                {l.label}
              </Link>
            ))}
          </nav>
        </div>

        <p className="mt-[var(--spacing-6)] text-xs text-[var(--color-muted)]">
          © {new Date().getFullYear()} {site.name}. Connecting a wallet is an identity
          step — it never requests a transaction, gas fee, or access to your assets.
        </p>
      </div>
    </footer>
  )
}
