import type { Metadata } from 'next'
import { ProfileView } from '@/components/profile/profile-view'

export const metadata: Metadata = {
  title: 'Profile',
  description: 'Your CCG player profile.',
  robots: { index: false },
}

export default function ProfilePage() {
  return (
    <div className="pt-[var(--spacing-7)]">
      <h1 className="font-display text-4xl font-bold tracking-[var(--tracking-display)] uppercase">
        Profile
      </h1>
      <ProfileView />
    </div>
  )
}
