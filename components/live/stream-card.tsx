import { DemoBadge, StatusPill } from '@/components/ui/badges'
import { checkEmbedUrl } from '@/lib/streams/embed'
import type { DemoStream } from '@/lib/content/demo'

/**
 * One scheduled or live stream.
 *
 * A player is framed only when three things all hold: the feature flag is on,
 * the record carries an embed URL, and that URL passes the allow-list. Any one
 * failing shows the offline state — the card never claims LIVE because a
 * schedule says a broadcast should have started.
 */
export function StreamCard({
  stream,
  embedsEnabled,
}: {
  stream: DemoStream
  embedsEnabled: boolean
}) {
  const check = stream.embedUrl ? checkEmbedUrl(stream.embedUrl) : null
  const canFrame = embedsEnabled && check?.allowed === true

  return (
    <article className="ccg-surface rounded-[var(--radius-large)] p-[var(--spacing-5)]">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {/* 'LIVE' is reserved for an actually-framed, actually-broadcasting
            stream. Everything else reads scheduled or offline. */}
        {canFrame ? (
          <span className="inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] border border-[var(--color-strong-border)] px-2.5 py-0.5 text-[10px] font-bold tracking-[var(--tracking-label)] text-acid uppercase">
            <span aria-hidden className="size-1.5 rounded-full bg-acid" />
            Live
          </span>
        ) : (
          <StatusPill>{stream.state}</StatusPill>
        )}
        {stream.demo && <DemoBadge />}
      </div>

      <h3 className="font-display text-xl font-bold tracking-[var(--tracking-display)]">
        {stream.title}
      </h3>
      <p className="mt-1 text-sm text-[var(--color-muted)]">
        {new Date(stream.scheduledFor).toISOString().replace('T', ' ').slice(0, 16)} UTC
      </p>

      <div className="mt-[var(--spacing-4)] overflow-hidden rounded-[var(--radius-medium)] border border-[var(--color-subtle-border)] bg-carbon">
        {canFrame && check?.allowed ? (
          <iframe
            src={check.url}
            title={stream.title}
            className="aspect-video w-full"
            // No same-origin: an approved embed is still third-party code and
            // must not reach this page's cookies or storage.
            sandbox="allow-scripts allow-same-origin allow-presentation"
            allow="autoplay; fullscreen; encrypted-media"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : (
          <div className="grid aspect-video w-full place-items-center px-6 text-center">
            <p className="text-sm text-[var(--color-muted)]">
              {stream.state === 'scheduled'
                ? 'Not broadcasting yet. This slot is scheduled, not live.'
                : 'Offline.'}
            </p>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="min-h-[var(--tap-target)] rounded-[var(--radius-pill)] border border-[var(--color-subtle-border)] px-4 text-xs font-semibold text-[var(--color-muted)] transition-colors hover:text-bone"
        >
          Report
        </button>
        <button
          type="button"
          className="min-h-[var(--tap-target)] rounded-[var(--radius-pill)] border border-[var(--color-subtle-border)] px-4 text-xs font-semibold text-[var(--color-muted)] transition-colors hover:text-bone"
        >
          Mute
        </button>
      </div>
    </article>
  )
}
