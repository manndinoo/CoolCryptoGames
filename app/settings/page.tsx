import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { readSession, sessionCookie } from '@/lib/auth/session'
import { readSessionResponse } from '@/lib/auth/session-state'
import { SettingsView } from '@/components/settings/settings-view'

export const metadata: Metadata = {
  title: 'Settings',
  description: 'Your account, what is stored about you, and what you can do about it.',
  // A personal surface has nothing to offer a search index and should not be
  // one of the first results for a player's own username.
  robots: { index: false },
}

// Dynamic, because it reads a cookie. That is the right shape for a page about
// one person's account, and reading the session here rather than in the browser
// is what removes the loading flash and the layout shift it caused.
export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const jar = await cookies()
  const claims = await readSession(jar.get(sessionCookie.name)?.value)
  const session = readSessionResponse({
    wallet: claims?.wallet ?? null,
    username: claims?.username ?? null,
  })

  return (
    <div className="pt-[var(--spacing-7)] pb-[var(--spacing-6)]">
      <h1 className="font-display text-4xl font-bold tracking-[var(--tracking-display)]">
        Settings
      </h1>
      <p className="mt-3 max-w-xl text-[var(--color-muted)]">
        Your account, your data, and the decisions you can appeal.
      </p>
      <SettingsView session={session} />
    </div>
  )
}
