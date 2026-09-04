"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { readRecent } from "@/components/play/recent";

type Entry = { slug: string; title: string; cover: string | null };

/**
 * "Pick up where you left off."
 *
 * Renders nothing at all for a first-time visitor, and nothing on the server —
 * the source is localStorage, so it mounts empty and fills in after hydration.
 * That avoids both a mismatch and, more importantly, an empty shelf: a rail
 * captioned "continue playing" with nothing under it is worse than no rail.
 *
 * This is the one piece of the site aimed squarely at return visits rather
 * than at first ones, and it is built entirely from the player's own history.
 * Nothing is inferred, recommended, or invented.
 */
export function ContinuePlaying({ games }: { games: Entry[] }) {
  const [recent, setRecent] = useState<Entry[]>([]);

  useEffect(() => {
    const bySlug = new Map(games.map((g) => [g.slug, g]));
    setRecent(
      readRecent()
        .map((entry) => bySlug.get(entry.slug))
        .filter((g): g is Entry => Boolean(g)),
    );
  }, [games]);

  if (recent.length === 0) return null;

  return (
    <section className="mb-[var(--spacing-6)]">
      <h2 className="mb-[var(--spacing-4)] text-[11px] font-bold tracking-[var(--tracking-label)] text-[var(--color-muted)] uppercase">
        Pick up where you left off
      </h2>
      <ul className="ccg-rail lg:grid lg:grid-cols-2 lg:gap-[var(--spacing-4)] lg:overflow-visible">
        {recent.map((game) => (
          <li key={game.slug} className="w-[72vw] max-w-sm shrink-0 lg:w-auto lg:max-w-none">
            <Link
              href={`/games/${game.slug}`}
              className="ccg-surface ccg-lift flex items-center gap-4 overflow-hidden rounded-[var(--radius-medium)] p-3"
            >
              <span className="relative size-14 shrink-0 overflow-hidden rounded-[var(--radius-small)] bg-[var(--color-carbon)]">
                {game.cover && (
                  <Image
                    src={game.cover}
                    alt=""
                    aria-hidden
                    fill
                    sizes="56px"
                    className="object-cover object-center"
                  />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{game.title}</span>
                <span className="mt-0.5 block text-xs text-[var(--color-muted)]">
                  Continue
                </span>
              </span>
              <span aria-hidden className="shrink-0 pr-2 text-accent">
                <svg viewBox="0 0 24 24" className="size-5" fill="currentColor">
                  <path d="M8 5v14l11-7L8 5Z" />
                </svg>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
