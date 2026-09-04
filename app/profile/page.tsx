import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { readSession, sessionCookie } from '@/lib/auth/session'
import { readSessionResponse } from '@/lib/auth/session-state'
import { ProfileView } from '@/components/profile/profile-view'

export const metadata: Metadata = {
  title: 'Profile',
  description: 'Your CCG player profile.',
  robots: { index: false },
}

// Dynamic, because it reads a cookie. That is the right shape for a page about
// one person's account, and reading the session here rather than in the browser
// is what removes the loading flash and the layout shift it caused.
export const dynamic = 'force-dynamic'

export default async function ProfilePage() {
  const jar = await cookies()
  const claims = await readSession(jar.get(sessionCookie.name)?.value)
  const session = readSessionResponse({
    wallet: claims?.wallet ?? null,
    username: claims?.username ?? null,
  })

  return (
    <div className="pt-[var(--spacing-7)]">
      <h1 className="font-display text-4xl font-black tracking-[var(--tracking-display)] uppercase">
        Profile
      </h1>
      <ProfileView session={session} />
    </div>
  )
}
