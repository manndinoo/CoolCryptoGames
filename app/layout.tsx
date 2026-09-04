import type { Metadata } from 'next'
import Link from 'next/link'
import { site } from '@/site.config'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: `${site.name} — ${site.tagline}`,
    template: `%s — ${site.name}`,
  },
  description: site.description,
  openGraph: {
    title: site.name,
    description: site.description,
    url: site.url,
    siteName: site.name,
    type: 'website',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="border-b border-white/10">
          <nav className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
            <Link href="/" className="text-lg font-semibold tracking-tight">
              {site.name}
            </Link>
            <Link
              href="/#games"
              className="text-sm text-white/70 transition hover:text-white"
            >
              Games
            </Link>
          </nav>
        </header>

        <main className="mx-auto max-w-5xl px-6 py-16">{children}</main>

        <footer className="border-t border-white/10">
          <div className="mx-auto max-w-5xl px-6 py-8 text-sm text-white/50">
            © {new Date().getFullYear()} {site.name}
          </div>
        </footer>
      </body>
    </html>
  )
}
