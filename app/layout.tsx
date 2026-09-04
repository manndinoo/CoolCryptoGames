import type { Metadata, Viewport } from 'next'
import { Inter, Space_Grotesk } from 'next/font/google'
import { Header } from '@/components/shell/header'
import { Sidebar } from '@/components/shell/sidebar'
import { PageTransition } from '@/components/shell/page-transition'
import { BottomNav } from '@/components/shell/bottom-nav'
import { FirstVisitNotice } from '@/components/shell/first-visit-notice'
import { Footer } from '@/components/shell/footer'
import { site } from '@/site.config'
import { Providers } from './providers'
import './globals.css'

// Both are SIL Open Font License, so they can ship without a licence purchase.
// The tokens file asks for a geometric grotesk for display and a highly legible
// sans for body; these are the pairing the reference boards were drawn with.
const display = Space_Grotesk({
  subsets: ['latin'],
  weight: ['500', '700'],
  variable: '--font-display',
})
const body = Inter({ subsets: ['latin'], variable: '--font-body' })

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: { default: `${site.name} — ${site.tagline}`, template: `%s — ${site.shortName}` },
  description: site.description,
  applicationName: site.name,
  manifest: '/manifest.webmanifest',
  openGraph: {
    title: site.name,
    description: site.description,
    url: site.url,
    siteName: site.name,
    type: 'website',
  },
}

export const viewport: Viewport = {
  themeColor: '#080A0D',
  // Lets the shell paint under the status bar and home indicator; the safe-area
  // tokens then keep actual content clear of them.
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body className="min-h-screen font-body">
        {/* Applies the stored sidebar width before the first paint. Without it
            the rail renders expanded and snaps closed once React hydrates,
            which is a visible jump on every page load for anyone who collapsed
            it. Inline and synchronous is the only way to beat the paint. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var v=localStorage.getItem('ccg:sidebar');if(v==='collapsed'||v==='expanded'){document.body.dataset.sidebar=v}}catch(e){}",
          }}
        />

        <Providers>
          <a
            href="#main"
            className="sr-only rounded-[var(--radius-small)] bg-acid px-4 py-2 font-semibold text-carbon focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50"
          >
            Skip to content
          </a>

          <Sidebar />

          {/* Everything that is not the fixed rail sits inside this, offset by
              exactly the rail's width. The offset is a custom property so the
              server can render the correct layout without knowing the stored
              preference — the script above sets it, not React. */}
          <div className="ccg-shell">
            <Header />

            <main
              id="main"
              className="mx-auto max-w-[var(--max-content)] px-[var(--mobile-gutter)] lg:px-[var(--desktop-gutter)]"
              // Reserve exactly the bottom-nav height on mobile so fixed chrome
              // never covers the end of the page.
              style={{ paddingBottom: 'calc(var(--mobile-bottom-nav) + var(--spacing-6))' }}
            >
              <PageTransition>{children}</PageTransition>
            </main>

            <Footer />
          </div>

          <BottomNav />
          <FirstVisitNotice />
        </Providers>
      </body>
    </html>
  )
}
