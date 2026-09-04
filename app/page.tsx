import Image from "next/image";
import { ContinuePlaying } from "@/components/home/continue-playing";
import Link from "next/link";
import { DemoBadge, StatusPill, VerifiedBadge } from "@/components/ui/badges";
import { SectionHeader } from "@/components/ui/section";
import {
  demoChannels,
  demoDevelopers,
  demoGames,
  demoTournaments,
  type DemoGame,
} from "@/lib/content/demo";
import { site } from "@/site.config";

/**
 * Home.
 *
 * Games are the first thing on the screen. The page used to open with a
 * full-height slogan and an oversized watermark, and you had to scroll past all
 * of it to reach two small cards — on a catalogue, the catalogue is the design,
 * and the argument for the product is the art, not a headline about the art.
 *
 * The intro is three lines and a link. Everything it used to say at 72px is
 * still said, in a size that leaves room for the thing it is introducing.
 */
export default function Home() {
  const games = demoGames;
  const tournament = demoTournaments[0] ?? null;
  const channel = demoChannels[0];
  const spotlight = demoDevelopers[0];

  return (
    <>
      {/* --------------------------------------------------------------- intro */}
      <section className="pt-[var(--spacing-6)] pb-[var(--spacing-6)]">
        <h1 className="font-display text-[clamp(1.75rem,4vw,2.5rem)] leading-[1.1] font-semibold tracking-[var(--tracking-display)]">
          {site.tagline}
        </h1>
        <p className="mt-3 max-w-xl text-[var(--color-muted)]">
          {site.description}
        </p>
        <p className="mt-4 text-sm text-[var(--color-muted)]">
          {site.productLine}
        </p>
      </section>

      {/* Returning players only. Absent, and rendering nothing, for everyone else. */}
      <ContinuePlaying
        games={games.map((g) => ({ slug: g.slug, title: g.title, cover: g.cover }))}
      />

      {/* --------------------------------------------------------------- games
          Two-up at desktop with the cover at 16:9. A four-column grid holding a
          two-game catalogue reads as a page that failed to load; a two-column
          one reads as a page with two games on it, and grows into rows rather
          than into gaps. */}
      <section className="ccg-stagger grid gap-[var(--spacing-4)] lg:grid-cols-2">
        {games.map((game, i) => (
          // `priority` marks the LCP image, and a page has one. It was on every
          // card, which put a preload link on each of them; the first two then
          // never finished loading at all — the browser held them at
          // `complete: false` with an empty currentSrc while the unprioritised
          // third card loaded normally, and the page never fired `load`.
          <FeatureCard key={game.slug} game={game} priority={i === 0} />
        ))}
      </section>

      {/* ------------------------------------------------------------- modules
          Three quiet rows rather than three panels. Each states what is
          genuinely there — which right now is mostly "nothing yet", and a large
          card is a lot of surface to spend saying that. */}
      <section className="mt-[var(--spacing-7)]">
        <SectionHeader title="Elsewhere on CCG" />
        <ul className="ccg-stagger grid gap-px overflow-hidden rounded-[var(--radius-large)] border border-[var(--color-subtle-border)] bg-[var(--color-subtle-border)] lg:grid-cols-3">
          <ModuleRow
            href={tournament ? `/tournaments/${tournament.slug}` : "/tournaments"}
            label="Tournaments"
            title={tournament ? tournament.name : "No event scheduled"}
            note={
              tournament
                ? tournament.format
                : "Free entry, published rules, verified results."
            }
            badge={tournament?.demo ? <DemoBadge label="Demo event" /> : null}
          />
          <ModuleRow
            href="/live"
            label="Live"
            title={channel.title}
            note="Nothing is broadcasting. Scheduled programming appears here once a provider is approved."
            badge={<StatusPill>{channel.state}</StatusPill>}
          />
          <ModuleRow
            href={`/developers/${spotlight.slug}`}
            label="Developers"
            title={spotlight.name}
            note={spotlight.bio}
            badge={spotlight.demo ? <DemoBadge /> : null}
          />
        </ul>
      </section>
    </>
  );
}

/** A game at the size its art deserves. */
function FeatureCard({ game, priority }: { game: DemoGame; priority: boolean }) {
  const ranked = game.scoreVerification === "deterministic-replay";

  return (
    <article className="ccg-surface ccg-lift group/card overflow-hidden rounded-[var(--radius-large)]">
      <Link href={`/games/${game.slug}`} className="block">
        <div className="relative aspect-[16/10] w-full overflow-hidden bg-[var(--color-carbon)]">
          {game.cover ? (
            <Image
              src={game.cover}
              alt={`${game.title} gameplay`}
              fill
              sizes="(max-width: 1024px) 100vw, 640px"
              className="object-cover transition-transform duration-[var(--duration-slow)] ease-[var(--ease-ccg)] group-hover/card:scale-[1.03]"
              priority={priority}
            />
          ) : (
            <div
              aria-hidden
              className="absolute inset-0"
              style={{
                background: `linear-gradient(140deg, ${game.art[0]} 0%, ${game.art[1]} 140%)`,
              }}
            />
          )}
        </div>

        <div className="p-[var(--spacing-5)]">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-bold tracking-[var(--tracking-label)] text-[var(--color-muted)] uppercase">
              {game.category}
            </span>
            {game.demo && <DemoBadge />}
            {ranked ? <VerifiedBadge /> : <StatusPill>Unranked</StatusPill>}
          </div>

          <h2 className="font-display text-xl font-semibold tracking-[var(--tracking-display)]">
            {game.title}
          </h2>
          <p className="mt-2 line-clamp-2 text-sm text-[var(--color-muted)]">
            {game.blurb}
          </p>

          <span className="mt-[var(--spacing-4)] inline-flex items-center gap-2 text-sm font-semibold text-accent">
            Play
            <svg viewBox="0 0 20 20" className="size-4" aria-hidden>
              <path
                d="M3 10h13m0 0-5-5m5 5-5 5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </div>
      </Link>
    </article>
  );
}

function ModuleRow({
  href,
  label,
  title,
  note,
  badge,
}: {
  href: string;
  label: string;
  title: string;
  note: string;
  badge?: React.ReactNode;
}) {
  return (
    <li className="bg-[var(--color-graphite)]">
      <Link
        href={href}
        className="flex h-full flex-col p-[var(--spacing-5)] transition-colors duration-[var(--duration-fast)] hover:bg-[var(--color-graphite-raised)]"
      >
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-bold tracking-[var(--tracking-label)] text-[var(--color-muted)] uppercase">
            {label}
          </span>
          {badge}
        </div>
        <p className="font-display text-base font-semibold tracking-[var(--tracking-display)]">
          {title}
        </p>
        <p className="mt-1.5 line-clamp-2 text-sm text-[var(--color-muted)]">{note}</p>
      </Link>
    </li>
  );
}
