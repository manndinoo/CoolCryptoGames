import Link from "next/link";
import { CcgMonogram, CcgTriTile } from "@/components/brand/logo";
import { DemoBadge, StatusPill } from "@/components/ui/badges";
import { GameCard } from "@/components/ui/game-card";
import {
  Section,
  SectionHeader,
} from "@/components/ui/section";
import {
  demoDevelopers,
  demoGames,
  demoChannels,
  demoTournaments,
} from "@/lib/content/demo";
import { site } from "@/site.config";

export default function Home() {
  const featured = demoGames;
  const playable = demoGames.filter((g) => g.status === "playable");
  const recentlyUpdated = [...demoGames].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
  // With a small catalogue this section lists exactly what Featured already
  // shows. Two identical rows read as padding, so it waits until there is
  // enough of a catalogue for "recent" to mean something.
  const showRecentlyUpdated = demoGames.length > 4;
  // May be absent: the catalogue ships with no scheduled event.
  const tournament = demoTournaments[0] ?? null;
  const channel = demoChannels[0];
  const spotlight = demoDevelopers[0];

  return (
    <>
      {/* ---------------------------------------------------------------- hero */}
      <section className="relative overflow-hidden rounded-[var(--radius-large)] pt-[var(--spacing-6)] pb-[var(--spacing-6)] lg:mt-[var(--spacing-5)] lg:px-[var(--spacing-7)] lg:pt-[var(--spacing-8)] lg:pb-[var(--spacing-7)]">
        {/* Restrained depth: one soft cobalt wash, no neon field. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 opacity-70"
          style={{
            background:
              "radial-gradient(120% 80% at 78% 8%, color-mix(in srgb, var(--color-cobalt) 30%, transparent) 0%, transparent 62%)",
          }}
        />

        {/* Our own mark, oversized and faint. The reference composition has key
            art here; inventing some would mean depicting a game that does not
            exist, so the brand geometry holds the space instead. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-6 -right-10 hidden opacity-[0.07] lg:block"
        >
          <CcgTriTile size={520} monochrome />
        </div>

        <div className="max-w-2xl">
          <h1 className="font-display text-[clamp(2.4rem,9vw,4.5rem)] leading-[0.95] font-bold tracking-[var(--tracking-display)] uppercase">
            <span className="block text-cobalt">Games first.</span>
            <span className="block">Crypto native.</span>
          </h1>

          <p className="mt-[var(--spacing-5)] max-w-md text-base text-[var(--color-muted)] lg:text-lg">
            {site.description}
          </p>

          <div className="mt-[var(--spacing-6)] flex flex-wrap items-center gap-3">
            <Link
              href={`/games/${playable[0]?.slug ?? ""}`}
              className="inline-flex min-h-[var(--tap-target)] items-center gap-3 rounded-[var(--radius-pill)] bg-acid px-7 text-sm font-bold tracking-[var(--tracking-label)] text-carbon uppercase transition-opacity duration-[var(--duration-fast)] hover:opacity-90"
            >
              Play now
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
            </Link>

            <Link
              href="/games"
              className="inline-flex min-h-[var(--tap-target)] items-center rounded-[var(--radius-pill)] border border-[var(--color-subtle-border)] px-6 text-sm font-semibold transition-colors hover:border-bone/40"
            >
              Browse the catalogue
            </Link>
          </div>

          <p className="mt-[var(--spacing-5)] text-xs text-[var(--color-muted)]">
            {site.productLine}
          </p>
        </div>
      </section>

      {/* ------------------------------------------------------------ trending */}
      <Section className="mt-[var(--spacing-6)]">
        <div className="ccg-surface flex items-center gap-4 overflow-hidden rounded-[var(--radius-medium)] px-4 py-3">
          <span className="flex shrink-0 items-center gap-2 text-[10px] font-bold tracking-[var(--tracking-label)] text-[var(--color-muted)] uppercase">
            <CcgMonogram size={16} monochrome className="text-acid" />
            Catalogue
          </span>
          <div className="ccg-rail gap-6">
            {demoGames.map((g) => (
              <Link
                key={g.slug}
                href={`/games/${g.slug}`}
                className="text-xs font-semibold whitespace-nowrap text-[var(--color-muted)] transition-colors hover:text-bone"
              >
                {g.title}
              </Link>
            ))}
          </div>
        </div>
      </Section>

      {/* ------------------------------------------------------- featured games */}
      <Section>
        <SectionHeader title="Featured games" href="/games" />
        {/* Rail on mobile so cards swipe with a visible peek; grid on desktop. */}
        <div className="ccg-rail ccg-stagger lg:grid lg:grid-cols-4 lg:gap-[var(--spacing-4)] lg:overflow-visible">
          {featured.map((game) => (
            <GameCard
              key={game.slug}
              game={game}
              className="w-[78vw] max-w-xs shrink-0 lg:w-auto lg:max-w-none lg:shrink"
            />
          ))}
        </div>
      </Section>

      {/* --------------------------------------------- tournament + live modules */}
      <Section className="ccg-stagger grid gap-[var(--spacing-4)] lg:grid-cols-2">
        <div className="ccg-surface rounded-[var(--radius-large)] p-[var(--spacing-5)]">
          <div className="mb-3 flex items-center gap-2">
            <span className="font-display text-xs font-bold tracking-[var(--tracking-label)] text-cobalt uppercase">
              Tournament
            </span>
            {tournament?.demo && <DemoBadge label="Demo event" />}
          </div>

          {tournament ? (
            <>
              <h3 className="font-display text-2xl font-bold tracking-[var(--tracking-display)]">
                {tournament.name}
              </h3>
              <p className="mt-1 text-sm text-[var(--color-muted)]">
                {tournament.format}
              </p>

              <dl className="mt-[var(--spacing-5)] grid gap-3 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-[var(--color-muted)]">Status</dt>
                  <dd>
                    <StatusPill>{tournament.status}</StatusPill>
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-[var(--color-muted)]">Rules version</dt>
                  <dd className="font-medium">{tournament.rules.version}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-[var(--color-muted)]">Prize</dt>
                  {/* Never a value without an approved Prize record. */}
                  <dd className="font-medium">Not yet announced</dd>
                </div>
              </dl>
            </>
          ) : (
            <>
              <h3 className="font-display text-2xl font-bold tracking-[var(--tracking-display)]">
                No event scheduled
              </h3>
              <p className="mt-2 text-sm text-[var(--color-muted)]">
                Nothing is running and nothing is announced. When an event is
                scheduled its rules are published before entry opens, and they do
                not change once it does.
              </p>
            </>
          )}

          <Link
            href={tournament ? `/tournaments/${tournament.slug}` : "/tournaments"}
            className="mt-[var(--spacing-5)] inline-flex min-h-[var(--tap-target)] items-center rounded-[var(--radius-pill)] border border-[var(--color-subtle-border)] px-6 text-sm font-semibold transition-colors hover:border-bone/40"
          >
            {tournament ? "Read the rules" : "How tournaments work"}
          </Link>
        </div>

        <div className="ccg-surface rounded-[var(--radius-large)] p-[var(--spacing-5)]">
          <div className="mb-3 flex items-center gap-2">
            <span className="font-display text-xs font-bold tracking-[var(--tracking-label)] text-cobalt uppercase">
              Live programming
            </span>
            {/* Offline is the honest state until a provider stream is configured. */}
            <StatusPill>{channel.state}</StatusPill>
          </div>

          <h3 className="font-display text-2xl font-bold tracking-[var(--tracking-display)]">
            {channel.title}
          </h3>
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            No stream is currently broadcasting. Scheduled programming appears
            here once a provider is configured and approved.
          </p>

          <Link
            href="/live"
            className="mt-[var(--spacing-5)] inline-flex min-h-[var(--tap-target)] items-center rounded-[var(--radius-pill)] border border-[var(--color-subtle-border)] px-6 text-sm font-semibold transition-colors hover:border-bone/40"
          >
            See the schedule
          </Link>
        </div>
      </Section>

      {/* --------------------------------------------------- developer spotlight */}
      <Section>
        <SectionHeader title="Developer spotlight" href="/developers" />
        <div className="ccg-surface flex flex-wrap items-center gap-[var(--spacing-5)] rounded-[var(--radius-large)] p-[var(--spacing-5)]">
          <div className="grid size-16 shrink-0 place-items-center rounded-[var(--radius-medium)] bg-[var(--color-graphite)]">
            <CcgMonogram size={32} />
          </div>
          <div className="min-w-56 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="font-display text-lg font-bold">
                {spotlight.name}
              </h3>
              {spotlight.demo && <DemoBadge />}
            </div>
            <p className="mt-1 text-sm text-[var(--color-muted)]">
              {spotlight.bio}
            </p>
          </div>
          <Link
            href={`/developers/${spotlight.slug}`}
            className="inline-flex min-h-[var(--tap-target)] items-center rounded-[var(--radius-pill)] border border-[var(--color-subtle-border)] px-6 text-sm font-semibold transition-colors hover:border-bone/40"
          >
            View developer
          </Link>
        </div>
      </Section>

      {/* ------------------------------------------------------ recently updated */}
      {showRecentlyUpdated && (
        <Section>
          <SectionHeader title="Recently updated" href="/games" />
          <div className="ccg-rail lg:grid lg:grid-cols-4 lg:gap-[var(--spacing-4)] lg:overflow-visible">
            {recentlyUpdated.map((game) => (
              <GameCard
                key={game.slug}
                game={game}
                className="w-[62vw] max-w-[240px] shrink-0 lg:w-auto lg:max-w-none lg:shrink"
              />
            ))}
          </div>
        </Section>
      )}
    </>
  );
}
