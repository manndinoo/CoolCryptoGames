import type { Metadata } from "next";
import { GameCard } from "@/components/ui/game-card";
import { demoGames } from "@/lib/content/demo";

export const metadata: Metadata = {
  title: "Games",
  description: "The curated CCG catalogue. Browse without connecting a wallet.",
};

/**
 * How many columns the catalogue gets.
 *
 * Follows the number of games rather than the width of the window. A fixed
 * four-column grid holding two games renders two cards and two holes, which
 * reads as a page that failed to load; matching the column count to what
 * exists means the row is always full, and the grid widens on its own as the
 * catalogue grows.
 */
const COLUMNS: Record<number, string> = {
  1: "lg:grid-cols-1",
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-3 2xl:grid-cols-4",
};

export default function GamesPage() {
  const columns = COLUMNS[Math.min(demoGames.length, 4)] ?? COLUMNS[4];

  return (
    <>
      <header className="pt-[var(--spacing-7)]">
        <h1 className="font-display text-4xl font-bold tracking-[var(--tracking-display)]">
          Games
        </h1>
        <p className="mt-3 max-w-lg text-[var(--color-muted)]">
          Browsing is open to everyone. A wallet is only needed at the moment
          you press play.
        </p>
      </header>

      <div
        className={`ccg-stagger mt-[var(--spacing-6)] grid grid-cols-2 gap-[var(--spacing-4)] ${columns}`}
      >
        {demoGames.map((game) => (
          <GameCard key={game.slug} game={game} />
        ))}
      </div>
    </>
  );
}
