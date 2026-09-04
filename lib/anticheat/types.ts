/** One player input, `t` milliseconds after the run started. */
export type InputEvent = { t: number; k: string }

export type SimResult = { score: number; durationMs: number }

/**
 * Server-side rules for one game.
 *
 * `simulate` is the whole point of this design: it must be DETERMINISTIC —
 * the same seed and the same input log must produce the same result on any
 * machine, every time. The browser build and this function have to be the
 * same logic, so keep the game's core in a shared module that both import
 * rather than writing it twice.
 *
 * The client never reports a score. It reports what the player pressed, and
 * the server works out what that was worth.
 */
export type GameRules = {
  slug: string
  /** Longest a single run may legitimately last. */
  maxDurationMs: number
  /** Ceiling no honest run can exceed. A backstop, not the main defence. */
  maxScore: number
  /** Sustained input rate above this is not a human hand. */
  maxInputsPerSecond: number
  simulate(seed: string, inputs: InputEvent[]): SimResult
}

export type PlaySessionRecord = {
  id: string
  gameSlug: string
  seed: string
  startedAt: number
  lastHeartbeatAt: number
  heartbeatCount: number
  /** Largest observed gap between heartbeats, in ms. */
  maxGapMs: number
  status: 'active' | 'submitted' | 'rejected' | 'abandoned'
}

export type Submission = {
  inputs: InputEvent[]
  /** Cross-checked against the server's own replay, never trusted. */
  claimedScore?: number
}

export type ValidationOk = {
  ok: true
  score: number
  durationMs: number
  /** Non-fatal oddities worth recording against the wallet. */
  signals: string[]
}

export type ValidationFail = {
  ok: false
  reasons: string[]
  computedScore: number | null
}

export type ValidationResult = ValidationOk | ValidationFail
