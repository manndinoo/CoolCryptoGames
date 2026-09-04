"use client";

import { Providers } from "@/app/providers";
import { PlayGateInner } from "./play-gate-inner";
import type { GameSummary } from "./types";

/**
 * The whole wallet-backed play flow in one module, so it is one lazy chunk.
 *
 * Loading the providers and the flow separately would mean two round trips in
 * sequence — the second import cannot start until the first has arrived and
 * rendered. Bundling them together makes it one fetch, which is what the
 * preload on hover is warming.
 */
export function PlaySession({
  game,
  onExit,
}: {
  game: GameSummary;
  onExit: () => void;
}) {
  return (
    <Providers>
      <PlayGateInner game={game} onExit={onExit} />
    </Providers>
  );
}
