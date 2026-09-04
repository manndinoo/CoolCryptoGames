/**
 * CCG Reflex Lab — the deterministic core.
 *
 * This module is the single source of truth for the game's rules. The browser
 * build imports it to run the game, and the server imports it to replay a
 * submitted run. Writing the logic twice is how a client and a server quietly
 * stop agreeing, so there is exactly one copy.
 *
 * Everything is a pure function of (seed, inputs). No wall-clock reads, no
 * Math.random, no floating-point accumulation across rounds — those are the
 * three things that break replay determinism in practice.
 */

export const ROUNDS = 5

/** Below this, no human nervous system is producing the press. */
export const HUMAN_FLOOR_MS = 80

/** A round's target appears somewhere in this window after the round starts. */
const MIN_DELAY_MS = 700
const MAX_DELAY_MS = 2_600

/** Deterministic 32-bit hash. Same string, same number, everywhere. */
function hashSeed(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** mulberry32. Small, fast, and identical across engines. */
function prng(state: number): () => number {
  let a = state
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * The delay before each round's target appears.
 *
 * Derived from the server's seed, so the client cannot know the timings in
 * advance and cannot search for a seed that produces an easy run. Integers
 * only — a float here would replay differently across engines.
 */
export function roundDelays(seed: string): number[] {
  const next = prng(hashSeed(seed))
  const delays: number[] = []
  for (let i = 0; i < ROUNDS; i++) {
    delays.push(MIN_DELAY_MS + Math.floor(next() * (MAX_DELAY_MS - MIN_DELAY_MS)))
  }
  return delays
}

export type InputEvent = { t: number; k: string }

export type ReflexResult = {
  /** Mean reaction time in whole milliseconds. Lower is better. */
  score: number
  durationMs: number
  reactions: number[]
}

/**
 * Replays a run.
 *
 * Round 1 starts at t=0; every later round starts when the previous press
 * landed, so the whole sequence is fixed by the seed plus the press times.
 *
 * Throws on a physically impossible run rather than scoring it. Two cases:
 * pressing before the target appeared (a false start, or a client that knows
 * the delays), and a reaction under the human floor. Neither is a low score to
 * be ranked — they are evidence the run did not happen as described, and the
 * submission validator surfaces the throw as a rejection.
 */
export function simulate(seed: string, inputs: InputEvent[]): ReflexResult {
  const delays = roundDelays(seed)
  const presses = inputs.filter((i) => i.k === 'press')

  if (presses.length !== ROUNDS) {
    throw new Error(`expected ${ROUNDS} presses, got ${presses.length}`)
  }

  const reactions: number[] = []
  let roundStart = 0

  for (let i = 0; i < ROUNDS; i++) {
    const targetAt = roundStart + delays[i]
    const pressedAt = presses[i].t

    const reaction = pressedAt - targetAt
    if (reaction < 0) throw new Error(`round ${i + 1}: pressed before the target appeared`)
    if (reaction < HUMAN_FLOOR_MS) throw new Error(`round ${i + 1}: reaction below the human floor`)

    reactions.push(reaction)
    roundStart = pressedAt
  }

  // Summed as integers and divided once, so the result cannot drift by a
  // floating-point ulp between two engines replaying the same run.
  const total = reactions.reduce((a, b) => a + b, 0)

  return {
    score: Math.round(total / ROUNDS),
    durationMs: presses[ROUNDS - 1].t,
    reactions,
  }
}
