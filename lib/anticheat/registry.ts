import type { GameRules } from './types'

/**
 * Server-side rules, one entry per game.
 *
 * A game only appears here once its logic can be replayed on the server. That
 * is the price of a verified leaderboard: a game the server cannot simulate
 * cannot have a score you are able to trust, so it should run without one.
 */
const registry = new Map<string, GameRules>()

export function registerGame(rules: GameRules): void {
  registry.set(rules.slug, rules)
}

export function getGameRules(slug: string): GameRules | null {
  return registry.get(slug) ?? null
}

export function hasVerifiedScoring(slug: string): boolean {
  return registry.has(slug)
}
