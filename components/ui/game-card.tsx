import Link from 'next/link'
import type { DemoGame } from '@/lib/content/demo'
import { DemoBadge, VerifiedBadge } from './badges'

/**
 * Placeholder key art.
 *
 * Real games will ship their own. Until then this renders a deterministic
 * gradient from the record's own token colours rather than borrowing the
 * concept art, which depicts games that do not exist.
 */
function ArtTile({ art, title }: { art: [string, string]; title: string }) {
  return (
    <div
      aria-hidden
      className="relative aspect-[4/3] w-full overflow-hidden rounded-[var(--radius-medium)]"
      style={{ background: `linear-gradient(140deg, ${art[0]} 0%, ${art[1]} 140%)` }}
    >
      <div className="absolute inset-0 opacity-25 mix-blend-overlay [background-image:repeating-linear-gradient(45deg,transparent,transparent_8px,rgba(0,0,0,0.35)_8px,rgba(0,0,0,0.35)_9px)]" />
      <span className="absolute right-3 bottom-3 font-display text-[11px] font-bold tracking-[var(--tracking-label)] text-carbon/70 uppercase">
        {title}
      </span>
    </div>
  )
}

export function GameCard({ game, className = '' }: { game: DemoGame; className?: string }) {
  return (
    <article className={`ccg-surface rounded-[var(--radius-large)] p-3 ${className}`}>
      <Link href={`/games/${game.slug}`} className="block">
        <ArtTile art={game.art} title={game.title} />

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
