import Image from 'next/image'
import Link from 'next/link'
import type { DemoGame } from '@/lib/content/demo'
import { DemoBadge, VerifiedBadge } from './badges'

/**
 * The card's art.
 *
 * A real cover is a screenshot taken from the game itself, so the card shows
 * what a player is about to open rather than an illustration of it. Games with
 * nothing to screenshot — catalogue placeholders — fall back to a gradient
 * built from their own token colours, which is honestly a placeholder rather
 * than borrowed concept art depicting a game that does not exist.
 */
function ArtTile({ game }: { game: DemoGame }) {
  if (game.cover) {
    return (
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-[var(--radius-medium)] bg-[var(--color-carbon)]">
        <Image
          src={game.cover}
          alt={`${game.title} gameplay`}
          fill
          // Two per row on mobile, four on desktop, capped at the grid width.
          sizes="(max-width: 640px) 45vw, (max-width: 1024px) 30vw, 320px"
          className="object-cover"
        />
      </div>
    )
  }

  return (
    <div
      aria-hidden
      className="relative aspect-[4/3] w-full overflow-hidden rounded-[var(--radius-medium)]"
      style={{ background: `linear-gradient(140deg, ${game.art[0]} 0%, ${game.art[1]} 140%)` }}
    >
      <div className="absolute inset-0 opacity-25 mix-blend-overlay [background-image:repeating-linear-gradient(45deg,transparent,transparent_8px,rgba(0,0,0,0.35)_8px,rgba(0,0,0,0.35)_9px)]" />
      <span className="absolute right-3 bottom-3 font-display text-[11px] font-bold tracking-[var(--tracking-label)] text-carbon/70 uppercase">
        {game.title}
      </span>
    </div>
  )
}

export function GameCard({ game, className = '' }: { game: DemoGame; className?: string }) {
  return (
    <article className={`ccg-surface rounded-[var(--radius-large)] p-3 ${className}`}>
      <Link href={`/games/${game.slug}`} className="block">
        <ArtTile game={game} />

        <div className="px-1 pt-3 pb-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-bold tracking-[var(--tracking-label)] text-[var(--color-muted)] uppercase">
              {game.category}
            </span>
            {game.demo && <DemoBadge />}
            {game.scoreVerification === 'deterministic-replay' && <VerifiedBadge />}
          </div>

          <h3 className="font-display text-base font-bold tracking-[var(--tracking-display)]">
            {game.title}
          </h3>

          {/* Truthful by construction: this reads 0 until real sessions exist. */}
          <p className="mt-1 text-xs text-[var(--color-muted)]">
            {game.verifiedPlayers === 0
              ? '0 verified players'
              : `${game.verifiedPlayers.toLocaleString()} verified players`}
          </p>
        </div>
      </Link>
    </article>
  )
}
