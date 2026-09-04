import Image from "next/image";
import Link from "next/link";
import { CcgMonogram } from "@/components/brand/logo";
import { ContinuePlaying } from "@/components/home/continue-playing";
import { DemoBadge, StatusPill, VerifiedBadge } from "@/components/ui/badges";
import {
  demoChannels,
  demoDevelopers,
  demoGames,
  demoTournaments,
  type DemoGame,
} from "@/lib/content/demo";
import { gridColumns } from "@/lib/ui/columns";
import { site } from "@/site.config";

/**
 * Home, in the shape of the supplied reference: a featured game holding the
 * first screen on its own art, a fact strip beneath it, then the catalogue.
 *
 * Where the reference carries figures — players online, a prize pool, follower
 * counts — this carries the real ones. There are no stored sessions yet, so
 * those slots show what is actually true instead. The layout is the reference's;
 * the numbers have to be ours.
 */
export default function Home() {
  const games = demoGames;
  const featured = games[0];
  const rest = games.slice(1);
  const tournament = demoTournaments[0] ?? null;
  const channel = demoChannels[0];
  const spotlight = demoDevelopers[0];

  return (
    <>
      {/* ---------------------------------------------------------------- hero */}
      {featured && <Hero game={featured} />}

      {/* --------------------------------------------------------- fact strip */}
      <div className="-mx-[var(--mobile-gutter)] flex flex-wrap items-stretch border-y border-[var(--color-line)] lg:-mx-[var(--desktop-gutter)]">
        <Fact accent label="Entry" value="Always free" />
        <Fact label="Wallet" value="Identity only" />
        <Fact label="Catalogue" value={`${games.length} games`} />
        <Fact label="Purchases" value="None, anywhere" />
      </div>

      <ContinuePlaying
        games={games.map((g) => ({ slug: g.slug, title: g.title, cover: g.cover }))}
      />

      {/* --------------------------------------------------------- catalogue */}
      <section className="relative mt-[var(--spacing-7)]">
        {/* The reference bleeds the mark behind this heading. Ours is the real
            artwork at low opacity, and it is decorative, so it is hidden from
            assistive technology. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-6 right-0 hidden opacity-[0.05] lg:block"
        >
          <CcgMonogram size={170} />
        </div>

        <h2 className="font-display text-2xl font-black tracking-[var(--tracking-display)] uppercase">
          Play something good
        </h2>
        <div className="ccg-rule mt-3 mb-[var(--spacing-5)]" />

        <div
          className={`ccg-stagger grid gap-[var(--spacing-4)] sm:grid-cols-2 ${gridColumns(rest.length, 2)}`}
        >
          {rest.map((game) => (
            <GameTile key={game.slug} game={game} />
          ))}
        </div>
      </section>

      {/* ----------------------------------------------------------- modules */}
      <section className="mt-[var(--spacing-7)] grid gap-[var(--spacing-4)] lg:grid-cols-2">
        <Module
          label="Creator spotlight"
          title={spotlight.name}
          note={spotlight.bio}
          href={`/developers/${spotlight.slug}`}
          action="View developer"
          badge={spotlight.demo ? <DemoBadge /> : <VerifiedBadge />}
        />
        <Module
          label={tournament ? "Open tournament" : "Tournaments"}
          title={tournament ? tournament.name : "No event scheduled"}
          note={
            tournament
              ? `${tournament.format} · free entry`
              : "Free entry, published rules, verified results. Nothing is running and nothing is announced."
          }
          href={tournament ? `/tournaments/${tournament.slug}` : "/tournaments"}
          action={tournament ? "Read the rules" : "How it works"}
          badge={tournament?.demo ? <DemoBadge label="Demo event" /> : null}
        />
      </section>

      {/* -------------------------------------------------------------- live */}
      <section className="ccg-surface mt-[var(--spacing-4)] flex flex-wrap items-center gap-[var(--spacing-5)] p-[var(--spacing-5)]">
        <span className="flex items-center gap-2 text-[10px] font-bold tracking-[var(--tracking-label)] text-[var(--color-muted)] uppercase">
          <span aria-hidden className="size-2 bg-[var(--color-muted)]" />
          Live
        </span>
        <p className="min-w-56 flex-1">
          <span className="font-display font-extrabold uppercase">{channel.title}</span>
          <span className="mt-1 block text-sm text-[var(--color-muted)]">
            Nothing is broadcasting. Scheduled programming appears here once a
            provider is configured and approved.
          </span>
        </p>
        <StatusPill>{channel.state}</StatusPill>
        <Link href="/live" className="ccg-btn ccg-btn-ghost">
          See the schedule
        </Link>
      </section>
    </>
  );
}

/** The first screen: one game, on its own art. */
function Hero({ game }: { game: DemoGame }) {
  return (
    <section className="relative -mx-[var(--mobile-gutter)] overflow-hidden lg:-mx-[var(--desktop-gutter)]">
      {game.cover && (
        <Image
          src={game.cover}
          alt=""
          aria-hidden
          fill
          priority
          sizes="100vw"
          className="object-cover object-center"
        />
      )}
      {/* Two stops rather than one: the art has to stay readable at the top and
          the type has to stay readable at the bottom. */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, color-mix(in srgb, var(--color-carbon) 25%, transparent) 0%, color-mix(in srgb, var(--color-carbon) 72%, transparent) 55%, var(--color-carbon) 100%)",
        }}
      />

      <div className="relative px-[var(--mobile-gutter)] pt-[var(--spacing-8)] pb-[var(--spacing-6)] lg:px-[var(--desktop-gutter)] lg:pt-[calc(var(--spacing-8)*2)]">
        <p className="text-[11px] font-bold tracking-[var(--tracking-label)] text-accent uppercase">
          Featured
        </p>
        <h1 className="mt-2 font-display text-[clamp(2.4rem,8vw,4.25rem)] leading-[0.92] font-black tracking-[var(--tracking-display)] uppercase">
          {game.title}
        </h1>
        <p className="mt-3 max-w-md text-[var(--color-muted)]">{game.blurb}</p>

        <div className="mt-[var(--spacing-5)] flex flex-wrap items-center gap-3">
          <Link href={`/games/${game.slug}`} className="ccg-btn ccg-btn-primary">
            <CcgMonogram size={22} />
            Play
          </Link>
          <Link href="/games" className="ccg-btn ccg-btn-ghost">
            Browse the catalogue
          </Link>
        </div>

        <p className="mt-[var(--spacing-5)] text-xs text-[var(--color-muted)]">
          {site.productLine}
        </p>
      </div>
    </section>
  );
}

/** One catalogue tile, with the reference's clipped corner. */
function GameTile({ game }: { game: DemoGame }) {
  const ranked = game.scoreVerification === "deterministic-replay";

  return (
    <article className="ccg-notch ccg-lift group/card">
      <Link href={`/games/${game.slug}`} className="block">
        <div className="relative aspect-[16/10] w-full overflow-hidden bg-[var(--color-carbon)]">
          {game.cover ? (
            <Image
              src={game.cover}
              alt={`${game.title} gameplay`}
              fill
              sizes="(max-width: 640px) 100vw, 520px"
              className="object-cover transition-transform duration-[var(--duration-slow)] ease-[var(--ease-ccg)] group-hover/card:scale-[1.04]"
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

        <div className="p-[var(--spacing-4)]">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-bold tracking-[var(--tracking-label)] text-[var(--color-muted)] uppercase">
              {game.category}
            </span>
            {game.demo && <DemoBadge />}
            {ranked ? <VerifiedBadge /> : <StatusPill>Unranked</StatusPill>}
          </div>

          <div className="flex items-end justify-between gap-4">
            <h3 className="font-display text-lg font-extrabold tracking-[var(--tracking-display)] uppercase">
              {game.title}
            </h3>
            <span className="shrink-0 text-[11px] font-bold tracking-[var(--tracking-label)] text-accent uppercase">
              Play ▸
            </span>
          </div>
        </div>
      </Link>
    </article>
  );
}

function Fact({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="flex-1 border-r border-[var(--color-line)] px-[var(--mobile-gutter)] py-3 last:border-r-0 lg:px-[var(--desktop-gutter)]">
      <p className="text-[10px] font-bold tracking-[var(--tracking-label)] text-[var(--color-muted)] uppercase">
        {label}
      </p>
      <p
        className={`mt-1 font-display text-sm font-extrabold whitespace-nowrap uppercase ${accent ? "text-accent" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}

function Module({
  label,
  title,
  note,
  href,
  action,
  badge,
}: {
  label: string;
  title: string;
  note: string;
  href: string;
  action: string;
  badge?: React.ReactNode;
}) {
  return (
    <div className="ccg-surface flex flex-col p-[var(--spacing-5)]">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-bold tracking-[var(--tracking-label)] text-accent uppercase">
          {label}
        </span>
        {badge}
      </div>
      <h3 className="font-display text-xl font-extrabold tracking-[var(--tracking-display)] uppercase">
        {title}
      </h3>
      <p className="mt-2 flex-1 text-sm text-[var(--color-muted)]">{note}</p>
      <Link href={href} className="ccg-btn ccg-btn-ghost mt-[var(--spacing-5)] self-start">
        {action}
      </Link>
    </div>
  );
}
