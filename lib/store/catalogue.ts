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
  /**
   * Price in whole US cents.
   *
   * Priced in dollars and charged in SOL: a dollar is what a price means to a
   * person, and the conversion happens when a purchase is quoted, at that
   * moment's rate. The lamport figure is then fixed on the intent, so a move in
   * the SOL price between the quote and the signature cannot change what the
   * player owes.
   */
  usdCents: number
}

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
    usdCents: 99,
  },
  {
    id: 'signal-brawl-chrome',
    gameSlug: 'signal-brawl',
    name: 'Chrome fighters',
    description:
      'A metallic set of fighter skins for all four slots. Appearance only — no change to reach, damage, speed or health.',
    kind: 'cosmetic',
    usdCents: 199,
  },
  {
    id: 'signal-brawl-arenas',
    gameSlug: 'signal-brawl',
    name: 'Extra arenas',
    description:
      'Three more arenas with their own hazards, added to the rotation. The six that ship with the game stay free and are not affected.',
    kind: 'content',
    usdCents: 299,
  },
]

export function itemsForGame(gameSlug: string): StoreItem[] {
  return storeItems.filter((i) => i.gameSlug === gameSlug)
}

export function findItem(gameSlug: string, itemId: string): StoreItem | null {
  return storeItems.find((i) => i.gameSlug === gameSlug && i.id === itemId) ?? null
}
