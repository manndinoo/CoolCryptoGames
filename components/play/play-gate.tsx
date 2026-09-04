"use client";

import { useState } from "react";
import Image from "next/image";
import { GameStage } from "./game-stage";
import { getGameRuntime } from "./runtimes";
import { useWalletAuth } from "./use-wallet-auth";
import { UsernameSetup } from "./username-setup";
import { WalletSheet } from "./wallet-sheet";

type GameSummary = {
  slug: string;
  title: string;
  status: "playable" | "coming-soon";
  /** Optional art shown behind the play control. */
  cover?: string | null;
  /** Whether the server can replay this game's runs and vouch for a score. */
  ranked: boolean;
};

/**
 * Guards the theater.
 *
 * The page around this is fully public — the gate appears only where the game
 * itself would mount, and only once someone actually presses Play. Loading a
 * game page must never trigger a wallet prompt on its own.
 */
export function PlayGate({ game }: { game: GameSummary }) {
  const { state, signIn, setUsername, connected } = useWalletAuth();
  const [requested, setRequested] = useState(false);

  if (game.status === "coming-soon") {
    return (
      <div className="ccg-surface grid aspect-video w-full place-items-center rounded-[var(--radius-large)] text-center">
        <div className="p-6">
          <p className="font-display text-sm font-bold tracking-[var(--tracking-label)] uppercase">
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

  if (state.status === "needs-username" && requested) {
    return <UsernameSetup onDone={setUsername} />;
  }

  if (state.status === "signed-in" && requested) {
    // Unranked games mount directly: the wallet gate has been satisfied, and
    // there is no score to issue a capability for. Ranked games additionally
    // need a server-issued play capability scoped to an exact build.
    // Games take the whole screen. A game boxed into a card competes with the
    // site's own chrome for the same taps, and on a phone that is most of the
    // display spent on navigation nobody looks at mid-run.
    //
    // Mounting straight away matters as much as the size: pressing Play is the
    // decision, and a second button confirming it is a step that exists only
    // because the code was written in two passes.
    // Games take the whole screen. A game boxed into a card competes with the
    // site's own chrome for the same taps, and on a phone that is most of the
    // display spent on navigation nobody looks at mid-run.
    //
    // Mounting straight away matters as much as the size: pressing Play is the
    // decision, and a second button confirming it is a step that exists only
    // because the code was written in two passes.
    if (!game.ranked) {
      // Two kinds of game ship here. One is a static build hosted under
      // /games/<slug>/ and framed in a sandbox; the other is a component this
      // site compiles. A slug with a registered runtime takes the second path.
      const Runtime = getGameRuntime(game.slug);

      return (
        <GameStage title={game.title} onExit={() => setRequested(false)}>
          {Runtime ? (
            <Runtime />
          ) : (
            <iframe
              src={`/games/${game.slug}/index.html`}
              title={game.title}
              className="h-full w-full border-0"
              // No allow-same-origin: the frame runs on an opaque origin with
              // no reach into cookies, storage or a wallet provider, and
              // `allow` grants no camera or microphone.
              sandbox="allow-scripts"
              allow="autoplay; fullscreen; gamepad; accelerometer; gyroscope"
              referrerPolicy="no-referrer"
            />
          )}
        </GameStage>
      );
    }

    return (
      <div className="ccg-surface grid aspect-video w-full place-items-center rounded-[var(--radius-large)] text-center">
        <div className="p-6">
          <p className="font-display text-sm font-bold tracking-[var(--tracking-label)] uppercase">
            Ranked runtime not yet wired
          </p>
          <p className="mt-2 max-w-md text-sm text-[var(--color-muted)]">
            Authentication succeeded. A ranked session needs a server-issued
            play capability scoped to this exact build, which is the next build
            step.
          </p>
        </div>
      </div>
    );
  }

  if (!requested) {
    return (
      <button
        onClick={() => setRequested(true)}
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
          <span className="ccg-pulse grid size-16 place-items-center rounded-full bg-acid text-carbon shadow-xl transition-transform duration-[var(--duration-normal)] group-hover:scale-105">
            <svg viewBox="0 0 24 24" className="ml-1 size-7" aria-hidden>
              <path d="M8 5v14l11-7L8 5Z" fill="currentColor" />
            </svg>
          </span>
          <span className="font-display text-sm font-bold tracking-[var(--tracking-label)] uppercase">
            Play {game.title}
          </span>
        </span>
      </button>
    );
  }

  return <WalletSheet state={state} onSignIn={signIn} connected={connected} />;
}
