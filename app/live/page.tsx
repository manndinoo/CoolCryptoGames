import type { Metadata } from 'next'
import { DemoBadge, StatusPill } from '@/components/ui/badges'
import { StreamCard } from '@/components/live/stream-card'
import { demoStreams } from '@/lib/content/demo'
import { features } from '@/lib/flags'
import { allowedHosts } from '@/lib/streams/embed'

export const metadata: Metadata = {
  title: 'Live',
  description: 'Official and approved CCG programming. Watching needs no wallet.',
}

export default function LivePage() {
  const hosts = allowedHosts()
  const embedsUsable = features.externalStreamEmbeds && hosts.length > 0

  return (
    <>
      <header className="pt-[var(--spacing-7)]">
        <h1 className="font-display text-4xl font-bold tracking-[var(--tracking-display)] uppercase">
          Live
        </h1>
        <p className="mt-3 max-w-xl text-[var(--color-muted)]">
          Official and approved programming. Watching requires no wallet and no account.
        </p>
      </header>

      {/* The honest state of the feature, stated rather than implied by an
          empty page. Phase 1 carries approved embeds only — there is no open
          broadcasting, by design. */}
      <p className="mt-[var(--spacing-5)] rounded-[var(--radius-medium)] border border-[var(--color-subtle-border)] bg-[var(--color-graphite)] p-4 text-sm text-[var(--color-muted)]">
        {embedsUsable
          ? `Approved embeds are enabled for ${hosts.length} host${hosts.length === 1 ? '' : 's'}. Only streams from allow-listed origins can be framed.`
          : 'External stream embeds are disabled in this environment, so nothing below can broadcast. Schedules are shown; players are not.'}
      </p>

      <section className="mt-[var(--spacing-6)]">
        <div className="mb-[var(--spacing-4)] flex items-center gap-3">
          <h2 className="font-display text-lg font-bold tracking-[var(--tracking-label)] uppercase">
            Schedule
          </h2>
          <StatusPill>{demoStreams.length} scheduled</StatusPill>
        </div>

        <ul className="grid gap-[var(--spacing-4)] lg:grid-cols-2">
          {demoStreams.map((stream) => (
            <li key={stream.slug}>
              <StreamCard stream={stream} embedsEnabled={embedsUsable} />
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-[var(--spacing-7)] max-w-xl">
        <h2 className="font-display text-sm font-bold tracking-[var(--tracking-label)] uppercase">
          Moderation
        </h2>
        <p className="mt-3 text-sm text-[var(--color-muted)]">
          Every stream surface carries report and mute controls, and an operator can take
          a stream down immediately. These entry points exist in the interface before any
          stream is live, so moderation is not something bolted on once there is something
          to moderate.
        </p>
      </section>
    </>
  )
}
