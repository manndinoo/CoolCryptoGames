import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DemoBadge, StatusPill, VerifiedBadge } from "@/components/ui/badges";
import { PlayGate } from "@/components/play/play-gate";
import { demoGames, getDemoDeveloper, getDemoGame } from "@/lib/content/demo";

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return demoGames.map((game) => ({ slug: game.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const game = getDemoGame(slug);
  if (!game) return {};
  return {
    title: game.title,
    description: game.blurb,
    openGraph: game.cover ? { images: [{ url: game.cover }] } : undefined,
  };
}

export default async function GamePage({ params }: Props) {
  const { slug } = await params;
  const game = getDemoGame(slug);
  if (!game) notFound();

  const developer = getDemoDeveloper(game.developerSlug);
  const ranked = game.scoreVerification === "deterministic-replay";

  return (
    <article className="pb-[var(--spacing-6)]">
      {/* --------------------------------------------------------------- hero
          The game's own art, enlarged and blurred behind the title, so the page
          takes its colour from the thing you are about to open rather than from
          a gradient someone picked. Real screenshot, not key art. */}
      <section className="relative -mx-[var(--mobile-gutter)] overflow-hidden lg:-mx-[var(--desktop-gutter)]">
        {game.cover && (
          <>
            <Image
              src={game.cover}
              alt=""
              aria-hidden
              fill
              priority
              sizes="100vw"
              className="scale-125 object-cover blur-2xl"
            />
            <div
              aria-hidden
              className="absolute inset-0"
              style={{
                background:
                  "linear-gradient(180deg, color-mix(in srgb, var(--color-carbon) 50%, transparent) 0%, color-mix(in srgb, var(--color-carbon) 86%, transparent) 60%, var(--color-carbon) 100%)",
              }}
            />
          </>
        )}

        <div className="relative px-[var(--mobile-gutter)] pt-[var(--spacing-5)] pb-[var(--spacing-6)] lg:px-[var(--desktop-gutter)]">
          <Link
            href="/games"
            className="text-sm text-[var(--color-muted)] transition-colors hover:text-bone"
          >
            ← All games
          </Link>

          <div className="mt-[var(--spacing-5)] gap-[var(--spacing-6)] lg:flex lg:items-end">
            {game.cover && (
              <div className="w-36 shrink-0 overflow-hidden rounded-[var(--radius-medium)] border border-white/10 shadow-2xl sm:w-44 lg:w-56">
                <Image
                  src={game.cover}
                  alt={`${game.title} gameplay`}
                  width={448}
                  height={336}
                  sizes="(max-width: 640px) 144px, 224px"
                  className="h-auto w-full"
                />
              </div>
            )}

            <div className="mt-[var(--spacing-5)] lg:mt-0">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-bold tracking-[var(--tracking-label)] text-[var(--color-muted)] uppercase">
                  {game.category}
                </span>
                {game.demo && <DemoBadge />}
                {ranked ? <VerifiedBadge /> : <StatusPill>Unranked</StatusPill>}
              </div>

              <h1 className="font-display text-[clamp(2.2rem,8vw,3.5rem)] leading-[0.95] font-bold tracking-[var(--tracking-display)]">
                {game.title}
              </h1>

              {developer && (
                <p className="mt-2 text-sm text-[var(--color-muted)]">
                  by{" "}
                  <Link
                    href={`/developers/${developer.slug}`}
                    className="text-bone transition-colors hover:text-accent"
                  >
                    {developer.name}
                  </Link>
                </p>
              )}

              <p className="mt-[var(--spacing-4)] max-w-lg text-[var(--color-muted)]">
                {game.blurb}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------------- play */}
      <div className="mt-[var(--spacing-5)]">
        <PlayGate
          game={{
            slug: game.slug,
            title: game.title,
            status: game.status,
            ranked,
            cover: game.cover,
          }}
        />
      </div>

      {/* -------------------------------------------------------------- facts
          Short and factual. Nothing here is a marketing claim, because a claim
          on this page is one nobody has verified. */}
      {game.facts.length > 0 && (
        <section className="mt-[var(--spacing-6)] grid gap-px overflow-hidden rounded-[var(--radius-large)] border border-[var(--color-subtle-border)] bg-[var(--color-subtle-border)] sm:grid-cols-2 lg:grid-cols-4">
          {game.facts.map((fact) => (
            <div
              key={fact.label}
              className="bg-[var(--color-graphite)] p-[var(--spacing-4)]"
            >
              <p className="text-[10px] font-bold tracking-[var(--tracking-label)] text-[var(--color-muted)] uppercase">
                {fact.label}
              </p>
              <p className="mt-1.5 text-sm font-medium">{fact.value}</p>
            </div>
          ))}
        </section>
      )}

      {/* ------------------------------------------------------------ gallery */}
      {game.screenshots.length > 0 && (
        <section className="mt-[var(--spacing-7)]">
          <h2 className="mb-[var(--spacing-4)] font-display text-[11px] font-bold tracking-[var(--tracking-label)] text-[var(--color-muted)] uppercase">
            Screenshots
          </h2>
          <div className="ccg-rail -mx-[var(--mobile-gutter)] px-[var(--mobile-gutter)] lg:mx-0 lg:px-0">
            {game.screenshots.map((shot, i) => (
              <div
                key={shot}
                // A fixed frame, with the image cropped to fill it. Letting each
                // shot set its own height made 500px-tall tiles out of portrait
                // captures, and the rail overflowed whatever was below it.
                //
                // The frame follows the game, though. Every capture from one
                // game shares its shape, and forcing a landscape arena into the
                // portrait frame the phone games use crops away both ends of it.
                className={`relative w-[52vw] max-w-[230px] shrink-0 overflow-hidden rounded-[var(--radius-medium)] border border-[var(--color-subtle-border)] bg-carbon ${
                  game.orientation === "landscape" ? "aspect-video" : "aspect-[3/4]"
                }`}
              >
                <Image
                  src={shot}
                  alt={`${game.title} screenshot ${i + 1}`}
                  fill
                  sizes="(max-width: 640px) 52vw, 230px"
                  // Centre crop. Anchoring to the top seemed right — phone
                  // screenshots put the HUD up there — but it framed the empty
                  // sky above a completion screen and cut the BONDED banner in
                  // half. These games keep their subject mid-frame.
                  className="object-cover object-center"
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ------------------------------------------------------- verification */}
      <section className="mt-[var(--spacing-7)] max-w-xl">
        <h2 className="font-display text-[11px] font-bold tracking-[var(--tracking-label)] text-[var(--color-muted)] uppercase">
          Score verification
        </h2>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          {ranked
            ? "Runs of this game are replayed on the server from the inputs you produced, so a result can be independently confirmed before it reaches a leaderboard."
            : "This game has no server-side replay yet, so results are not ranked. It runs for play only."}
        </p>
        {ranked && (
          <Link
            href={`/leaderboards/${game.slug}`}
            className="mt-[var(--spacing-5)] inline-flex min-h-[var(--tap-target)] items-center rounded-[var(--radius-pill)] border border-[var(--color-subtle-border)] px-6 text-sm font-semibold transition-colors hover:border-bone/40"
          >
            View the leaderboard
          </Link>
        )}
      </section>
    </article>
  );
}
