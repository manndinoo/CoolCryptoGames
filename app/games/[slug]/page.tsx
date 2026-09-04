import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { WalletGate } from "@/components/wallet-gate";
import { games, getGame } from "@/lib/games";

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return games.map((game) => ({ slug: game.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const game = getGame(slug);
  if (!game) return {};
  return { title: game.title, description: game.blurb };
}

export default async function GamePage({ params }: Props) {
  const { slug } = await params;
  const game = getGame(slug);
  if (!game) notFound();

  return (
    <article>
      <Link href="/#games" className="text-sm text-white/50 hover:text-white">
        ← All games
      </Link>

      <h1 className="mt-6 text-4xl font-semibold tracking-tight">
        {game.title}
      </h1>
      <p className="mt-3 max-w-xl text-white/60">{game.blurb}</p>

      <div className="mt-10">
        <WalletGate>
          <div className="overflow-hidden rounded-xl border border-white/10 bg-black">
            {game.status === "live" ? (
              <iframe
                src={game.playUrl}
                title={game.title}
                className="aspect-video w-full"
                allow="autoplay; fullscreen; gamepad"
              />
            ) : (
              <div className="flex aspect-video w-full items-center justify-center text-white/40">
                Not playable yet.
              </div>
            )}
          </div>
        </WalletGate>
      </div>
    </article>
  );
}
