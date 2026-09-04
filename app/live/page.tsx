import type { Metadata } from 'next'
import Link from 'next/link'
import { DemoBadge, StatusPill } from '@/components/ui/badges'
import { demoChannels } from '@/lib/content/demo'
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
        <h1 className="font-display text-4xl font-black tracking-[var(--tracking-display)] uppercase">
          Live
        </h1>
        <p className="mt-3 max-w-xl text-[var(--color-muted)]">
          Official and approved programming. Watching requires no wallet and no account.
        </p>
      </header>

      <div className="mt-[var(--spacing-5)] grid gap-3 rounded-[var(--radius-medium)] border border-[var(--color-subtle-border)] bg-[var(--color-graphite)] p-4 text-sm text-[var(--color-muted)]">
        <p>
          <strong className="text-bone">Approved creator streams</strong> —{' '}
          {embedsUsable
            ? `enabled for ${hosts.length} allow-listed host${hosts.length === 1 ? '' : 's'}. A creator playing with their camera on streams through their own provider; their encoder composites game and facecam before it reaches CCG.`
            : 'disabled in this environment. When enabled, a creator playing with their camera on streams through their own provider, which composites game and facecam before it reaches CCG.'}
        </p>
        <p>
          <strong className="text-bone">CCG-hosted broadcasting</strong> —{' '}
          {features.nativeStreaming
            ? 'enabled.'
            : 'not enabled. CCG capturing a game frame and a player camera directly is a later phase of the streaming rollout and needs a distribution provider and a full moderation operation behind it.'}
        </p>
      </div>

      <section className="mt-[var(--spacing-6)]">
        <div className="mb-[var(--spacing-4)] flex items-center gap-3">
          <h2 className="font-display text-lg font-extrabold tracking-[var(--tracking-display)] uppercase">
            Channels
          </h2>
          <StatusPill>{demoChannels.length}</StatusPill>
        </div>

        <ul className="grid gap-[var(--spacing-4)] lg:grid-cols-3">
          {demoChannels.map((channel) => (
            <li key={channel.slug}>
              <Link
                href={`/live/${channel.slug}`}
                className="ccg-surface block rounded-[var(--radius-large)] p-[var(--spacing-5)] transition-colors hover:border-bone/25"
              >
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <StatusPill>{channel.state}</StatusPill>
                  {channel.demo && <DemoBadge />}
                </div>
                <h3 className="font-display text-lg font-bold tracking-[var(--tracking-display)]">
                  {channel.title}
                </h3>
                <p className="mt-1 text-sm text-[var(--color-muted)]">{channel.broadcaster}</p>
                {channel.scheduledFor && (
                  <p className="mt-3 text-xs text-[var(--color-muted)]">
                    {new Date(channel.scheduledFor).toISOString().replace('T', ' ').slice(0, 16)} UTC
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-[var(--spacing-7)] max-w-xl">
        <h2 className="font-display text-[11px] font-bold tracking-[var(--tracking-label)] text-[var(--color-muted)] uppercase">
          Streaming on CCG
        </h2>
        <p className="mt-3 text-sm text-[var(--color-muted)]">
          Broadcasting is pre-approved, not open. Anonymous streaming is not something CCG
          offers — every channel has a named, approved broadcaster behind it, and report,
          mute and takedown controls exist on every stream surface before any stream is
          live.
        </p>
        <Link
          href="/live/go-live"
          className="mt-[var(--spacing-5)] ccg-btn ccg-btn-ghost"
        >
          Broadcaster setup
        </Link>
      </section>
    </>
  )
}
