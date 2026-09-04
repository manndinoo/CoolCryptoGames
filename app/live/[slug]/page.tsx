import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { DemoBadge, StatusPill } from '@/components/ui/badges'
import { Theater } from '@/components/live/theater'
import { Chat } from '@/components/live/chat'
import { demoChannels, getDemoChannel, getDemoGame } from '@/lib/content/demo'
import { features } from '@/lib/flags'
import { allowedHosts } from '@/lib/streams/embed'
import { resolveViewerRender } from '@/lib/streams/layout'

type Props = { params: Promise<{ slug: string }> }

export function generateStaticParams() {
  return demoChannels.map((c) => ({ slug: c.slug }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const c = getDemoChannel(slug)
  return c ? { title: c.title, description: `${c.broadcaster} on Cool Crypto Games` } : {}
}

export default async function ChannelPage({ params }: Props) {
  const { slug } = await params
  const channel = getDemoChannel(slug)
  if (!channel) notFound()

  const render = resolveViewerRender({
    channel,
    externalEmbedsEnabled: features.externalStreamEmbeds,
    nativeStreamingEnabled: features.nativeStreaming,
    allowedHosts: allowedHosts(),
  })

  const game =
    channel.source?.kind === 'native' && channel.source.gameSlug
      ? getDemoGame(channel.source.gameSlug)
      : null

  return (
    <article className="pt-[var(--spacing-6)]">
      <Link href="/live" className="text-sm text-[var(--color-muted)] hover:text-bone">
        ← All channels
      </Link>

      <div className="mt-[var(--spacing-5)] grid gap-[var(--spacing-4)] lg:grid-cols-[1fr_320px] lg:items-start">
        <div>
          <Theater render={render} />

          <header className="mt-[var(--spacing-5)]">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <StatusPill>{channel.state}</StatusPill>
              {channel.demo && <DemoBadge />}
              {channel.source?.kind === 'native' && <StatusPill>CCG-hosted</StatusPill>}
              {channel.source?.kind === 'external-embed' && <StatusPill>Creator provider</StatusPill>}
            </div>

            <h1 className="font-display text-3xl font-bold tracking-[var(--tracking-display)]">
              {channel.title}
            </h1>
            <p className="mt-2 text-sm text-[var(--color-muted)]">
              {channel.broadcaster}
              {game && (
                <>
                  {' · playing '}
                  <Link href={`/games/${game.slug}`} className="text-bone hover:text-acid">
                    {game.title}
                  </Link>
                </>
              )}
            </p>
          </header>

          <div className="mt-[var(--spacing-5)] flex flex-wrap gap-2">
            <ModButton>Report</ModButton>
            <ModButton>Mute</ModButton>
            <ModButton>Follow</ModButton>
          </div>
        </div>

        <Chat channelSlug={channel.slug} enabled />
      </div>
    </article>
  )
}

function ModButton({ children }: { children: React.ReactNode }) {
  return (
    <button
      type="button"
      className="min-h-[var(--tap-target)] rounded-[var(--radius-pill)] border border-[var(--color-subtle-border)] px-5 text-xs font-semibold text-[var(--color-muted)] transition-colors hover:text-bone"
    >
      {children}
    </button>
  )
}
