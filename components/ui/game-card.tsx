import Image from 'next/image'
import Link from 'next/link'
import type { DemoGame } from '@/lib/content/demo'
import { DemoBadge, StatusPill, VerifiedBadge } from './badges'

/**
 * A catalogue tile.
 *
 * Carries the reference's clipped corner and its type hierarchy: a tiny tracked
 * category label, a heavy uppercase title, and the accent reserved for the one
 * thing you can do with the card.
 *
 * A real cover is a screenshot taken from the game itself, so the card shows
 * what a player is about to open rather than an illustration of it. Entries
 * with nothing to screenshot fall back to a gradient built from their own
 * token colours, which reads as a placeholder in a way borrowed key art would
 * not.
 */
export function GameCard({ game, className = '' }: { game: DemoGame; className?: string }) {
  const ranked = game.scoreVerification === 'deterministic-replay'

  return (
    <article className={`ccg-notch ccg-lift group/card ${className}`}>
      <Link href={`/games/${game.slug}`} className="block">
        <div className="relative aspect-[4/3] w-full overflow-hidden bg-[var(--color-carbon)]">
          {game.cover ? (
            <Image
              src={game.cover}
              alt={`${game.title} gameplay`}
              fill
              sizes="(max-width: 640px) 45vw, (max-width: 1024px) 30vw, 340px"
              className="object-cover transition-transform duration-[var(--duration-slow)] ease-[var(--ease-ccg)] group-hover/card:scale-[1.04]"
            />
          ) : (
            <div
              aria-hidden
              className="absolute inset-0"
              style={{ background: `linear-gradient(140deg, ${game.art[0]} 0%, ${game.art[1]} 140%)` }}
            />
          )}
        </div>

        <div className="p-[var(--spacing-4)]">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-bold tracking-[var(--tracking-label)] text-[var(--color-muted)] uppercase">
              {game.category}
            </span>
            {game.demo && <DemoBadge />}
            {ranked ? <VerifiedBadge /> : <StatusPill>Unranked</StatusPill>}
          </div>

          <h3 className="font-display text-base font-extrabold tracking-[var(--tracking-display)] uppercase">
            {game.title}
          </h3>

          <div className="mt-2 flex items-center justify-between gap-3">
            {/* Truthful by construction: this reads 0 until real sessions exist. */}
            <p className="text-xs text-[var(--color-muted)]">
              {game.verifiedPlayers === 0
                ? '0 verified players'
                : `${game.verifiedPlayers.toLocaleString()} verified players`}
            </p>
            <span className="shrink-0 text-[10px] font-bold tracking-[var(--tracking-label)] text-accent uppercase">
              Play ▸
            </span>
          </div>
        </div>
      </Link>
    </article>
  )
}
