import type { Metadata } from 'next'
import { SettingsView } from '@/components/settings/settings-view'

export const metadata: Metadata = {
  title: 'Settings',
  description: 'Your account, what is stored about you, and what you can do about it.',
  // A personal surface has nothing to offer a search index and should not be
  // one of the first results for a player's own username.
  robots: { index: false },
}

export default function SettingsPage() {
  return (
    <div className="pt-[var(--spacing-7)] pb-[var(--spacing-6)]">
      <h1 className="font-display text-4xl font-bold tracking-[var(--tracking-display)] uppercase">
        Settings
      </h1>
      <p className="mt-3 max-w-xl text-[var(--color-muted)]">
        Your account, your data, and the decisions you can appeal.
      </p>
      <SettingsView />
    </div>
  )
}
