"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import type { GameSummary } from "./types";

/**
 * The wallet stack, the sign-in flow and the game shell, fetched on demand.
 *
 * `ssr: false` because the adapter reads `window` on mount; rendering it on the
 * server produces a hydration mismatch rather than a head start.
 */
const PlaySession = dynamic(
  () => import("./play-session").then((m) => m.PlaySession),
  {
    ssr: false,
    loading: () => (
      <div className="ccg-surface grid aspect-video w-full place-items-center rounded-[var(--radius-large)]">
        <p className="text-sm text-[var(--color-muted)]">Preparing…</p>
      </div>
    ),
  },
);

/** Warms that chunk before the click. Safe to call repeatedly. */
function preloadPlay(): void {
  void import("./play-session");
}

/**
 * Guards the theater.
 *
 * The page around this is fully public — the gate appears only where the game
 * itself would mount, and only once someone actually presses Play. Loading a
 * game page must never trigger a wallet prompt on its own.
 *
 * This half imports no wallet code at all. That is the point: a game page is a
 * browsing surface, and until someone commits to playing there is no reason
 * for their phone to have downloaded and parsed a wallet adapter. The chunk is
 * warmed on hover or first touch, so the wait usually lands before the click
 * rather than after it.
 */
export function PlayGate({ game }: { game: GameSummary }) {
  const [requested, setRequested] = useState(false);

  if (game.status === "coming-soon") {
    return (
      <div className="ccg-surface grid aspect-video w-full place-items-center rounded-[var(--radius-large)] text-center">
        <div className="p-6">
          <p className="font-display text-[11px] font-bold tracking-[var(--tracking-label)] text-[var(--color-muted)] uppercase">
            Not released
          </p>
          <p className="mt-2 max-w-sm text-sm text-[var(--color-muted)]">
            This catalogue entry is in review. New builds never publish
            automatically.
          </p>
        </div>
      </div>
    );
  }

  if (requested) {
    return <PlaySession game={game} onExit={() => setRequested(false)} />;
  }

  return (
    <button
      onClick={() => setRequested(true)}
      onPointerEnter={preloadPlay}
      onFocus={preloadPlay}
      // Touch has no hover, so the download starts on the press rather than on
      // the release — about 100ms of head start, for free.
      onTouchStart={preloadPlay}
      className="group relative mx-auto grid aspect-[4/3] w-full max-w-3xl place-items-center overflow-hidden rounded-[var(--radius-large)] border border-[var(--color-subtle-border)] bg-[var(--color-graphite)] sm:aspect-video"
    >
      {game.cover && (
        <>
          <Image
            src={game.cover}
            alt=""
            aria-hidden
            fill
            sizes="(max-width: 768px) 100vw, 768px"
            className="object-cover transition-transform duration-[var(--duration-slow)] group-hover:scale-[1.03]"
          />
          <span
            aria-hidden
            className="absolute inset-0 bg-carbon/55 transition-colors group-hover:bg-carbon/45"
          />
        </>
      )}

      <span className="relative flex flex-col items-center gap-3">
        <span className="ccg-pulse grid size-16 place-items-center rounded-full bg-accent text-white shadow-xl transition-transform duration-[var(--duration-normal)] group-hover:scale-105">
          <svg viewBox="0 0 24 24" className="ml-1 size-7" aria-hidden>
            <path d="M8 5v14l11-7L8 5Z" fill="currentColor" />
          </svg>
        </span>
        <span className="font-display text-[11px] font-bold tracking-[var(--tracking-label)] text-[var(--color-muted)] uppercase">
          Play {game.title}
        </span>
      </span>
    </button>
  );
}
