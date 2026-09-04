"use client";

import { useEffect } from "react";
import { GameStage } from "./game-stage";
import { PlaySteps } from "./play-steps";
import { recordPlay } from "./recent";
import { getGameRuntime } from "./runtimes";
import { useWalletAuth } from "./use-wallet-auth";
import { UsernameSetup } from "./username-setup";
import { WalletSheet } from "./wallet-sheet";
import type { GameSummary } from "./types";

/**
 * Everything behind the Play button.
 *
 * Separate from `PlayGate` because this half imports the wallet stack and the
 * other half must not: a game page has to render, and be readable, without
 * 300KB of adapter code arriving first.
 */
export function PlayGateInner({
  game,
  onExit,
}: {
  game: GameSummary;
  onExit: () => void;
}) {
  const { state, signIn, setUsername, connected } = useWalletAuth();
  const playing = state.status === "signed-in";

  // Recorded when the game actually opens, not when Play was pressed — a run
  // that never started is not something to offer to resume.
  useEffect(() => {
    if (playing) recordPlay(game.slug);
  }, [playing, game.slug]);

  if (state.status === "needs-username") {
    return (
      <div>
        <PlaySteps current={3} />
        <UsernameSetup onDone={setUsername} />
      </div>
    );
  }

  if (playing) {
    // Unranked games mount directly: the wallet gate has been satisfied, and
    // there is no score to issue a capability for. Ranked games additionally
    // need a server-issued play capability scoped to an exact build.
    if (!game.ranked) {
      // Two kinds of game ship here. One is a static build hosted under
      // /games/<slug>/ and framed in a sandbox; the other is a component this
      // site compiles. A slug with a registered runtime takes the second path.
      const Runtime = getGameRuntime(game.slug);

      return (
        <GameStage title={game.title} onExit={onExit}>
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
          <p className="font-display text-[11px] font-bold tracking-[var(--tracking-label)] text-[var(--color-muted)] uppercase">
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

  return (
    <div>
      <PlaySteps current={2} />
      <WalletSheet state={state} onSignIn={signIn} connected={connected} />
    </div>
  );
}
