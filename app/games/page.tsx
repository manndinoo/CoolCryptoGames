import type { Metadata } from "next";
import { GameCard } from "@/components/ui/game-card";
import { demoGames } from "@/lib/content/demo";

export const metadata: Metadata = {
  title: "Games",
  description: "The curated CCG catalogue. Browse without connecting a wallet.",
};

export default function GamesPage() {
  return (
    <>
      <header className="pt-[var(--spacing-7)]">
        <h1 className="font-display text-4xl font-bold tracking-[var(--tracking-display)] uppercase">
          Games
        </h1>
        <p className="mt-3 max-w-lg text-[var(--color-muted)]">
          Browsing is open to everyone. A wallet is only needed at the moment
          you press play.
        </p>
      </header>

      <div className="ccg-stagger mt-[var(--spacing-6)] grid grid-cols-2 gap-[var(--spacing-4)] lg:grid-cols-4">
        {demoGames.map((game) => (
          <GameCard key={game.slug} game={game} />
        ))}
      </div>
    </>
  );
}
