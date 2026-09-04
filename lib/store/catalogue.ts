/**
 * What a game is allowed to sell.
 *
 * Two kinds exist, and the type system only has these two:
 *
 *   cosmetic — how something looks. A theme, a trail, a colourway.
 *   content  — more of the game. An extra arena, a level pack.
 *
 * There is deliberately no third kind. Lives, extra attempts, boosts, revives,
 * stat increases, tournament entries and anything else that changes what a
 * player can achieve are excluded by the founding product, and the absence of
 * a `kind` for them is what makes that a structural fact rather than a promise:
 * there is no value an item could carry to become competitive, and the database
 * CHECK constraint refuses the row too.
 *
 * The rule that follows from it: buying nothing must never make a game worse.
 * Every game in the catalogue is complete and playable, ranked or not, by a
 * wallet that has never spent anything.
 */

export type ItemKind = 'cosmetic' | 'content'

export type StoreItem = {
  id: string
  gameSlug: string
  name: string
  /** What the buyer actually gets, in plain words. Shown before the prompt. */
  description: string
  kind: ItemKind
  /** Price in lamports. 1 SOL = 1_000_000_000 lamports. */
  lamports: number
}

export const LAMPORTS_PER_SOL = 1_000_000_000

/**
 * The live catalogue.
 *
 * Empty for a game means that game sells nothing, which is the default and is
 * a perfectly good state for it to stay in.
 */
export const storeItems: StoreItem[] = [
  {
    id: 'zero-signal-neon',
    gameSlug: 'zero-signal',
    name: 'Neon trail',
    description:
      'A brighter trail behind the ball, and a matching gate colourway. Appearance only — the ball handles exactly the same.',
    kind: 'cosmetic',
    lamports: 0.05 * LAMPORTS_PER_SOL,
  },
  {
    id: 'signal-brawl-chrome',
    gameSlug: 'signal-brawl',
    name: 'Chrome fighters',
    description:
      'A metallic set of fighter skins for all four slots. Appearance only — no change to reach, damage, speed or health.',
    kind: 'cosmetic',
    lamports: 0.05 * LAMPORTS_PER_SOL,
  },
  {
    id: 'signal-brawl-arenas',
    gameSlug: 'signal-brawl',
    name: 'Extra arenas',
    description:
      'Three more arenas with their own hazards, added to the rotation. The six that ship with the game stay free and are not affected.',
    kind: 'content',
    lamports: 0.15 * LAMPORTS_PER_SOL,
  },
]

export function itemsForGame(gameSlug: string): StoreItem[] {
  return storeItems.filter((i) => i.gameSlug === gameSlug)
}

export function findItem(gameSlug: string, itemId: string): StoreItem | null {
  return storeItems.find((i) => i.gameSlug === gameSlug && i.id === itemId) ?? null
}

/** Price for display. Trailing zeros trimmed, never rounded up. */
export function formatSol(lamports: number): string {
  const sol = lamports / LAMPORTS_PER_SOL
  return `${sol.toFixed(4).replace(/\.?0+$/, '')} SOL`
}
