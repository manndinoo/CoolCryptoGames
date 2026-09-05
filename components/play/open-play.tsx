"use client";

import { useEffect } from "react";
import { GameStage } from "./game-stage";
import { recordPlay } from "./recent";
import { getGameRuntime } from "./runtimes";
import { SandboxedGame } from "./sandboxed-game";
import type { GameSummary } from "./types";

/**
 * A game, opened with no wallet involved.
 *
 * The counterpart to `PlayGateInner`, and deliberately a separate module: that
 * one pulls in the Solana adapter stack, and the whole point of this path is
 * that nothing here does. Pressing Play on an ungated game downloads the game
 * and the save bridge, and about 300KB of wallet code that would never have
 * been used stays on the server.
 *
 * Saves still work, and still bind to a wallet when there is one. The save
 * bridge asks the server for this game's copy either way; a signed-out visitor
 * gets a 401 it already treats as "nothing stored", and keeps its progress in
 * the browser. Someone who happens to be signed in from `/settings` gets their
 * wallet's copy here without this component knowing anything about wallets,
 * because the session is a cookie and the adapter is only ever needed to
 * create one.
 */
export function OpenPlay({
  game,
  onExit,
}: {
  game: GameSummary;
  onExit: () => void;
}) {
  // Recorded on open, matching the gated path: a game you actually started is
  // one worth offering to resume.
  useEffect(() => {
    recordPlay(game.slug);
  }, [game.slug]);

  // Two kinds of game ship here. One is a static build hosted under
  // /games/<slug>/ and framed in a sandbox; the other is a component this site
  // compiles. A slug with a registered runtime takes the second path.
  const Runtime = getGameRuntime(game.slug);

  return (
    <GameStage title={game.title} onExit={onExit}>
      {Runtime ? <Runtime /> : <SandboxedGame slug={game.slug} title={game.title} />}
    </GameStage>
  );
}
