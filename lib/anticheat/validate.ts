import {
  CLOCK_TOLERANCE_MS,
  CLOCK_TOLERANCE_RATIO,
  HEARTBEAT_INTERVAL_MS,
  MAX_HEARTBEAT_GAP_MS,
  MIN_TIMING_VARIATION,
  RATE_WINDOW_MS,
  TIMING_VARIATION_MIN_EVENTS,
} from './constants'
import type {
  GameRules,
  InputEvent,
  PlaySessionRecord,
  Submission,
  ValidationResult,
} from './types'

/**
 * Decides whether a submitted run is real.
 *
 * The threat this is built against: a player who disconnects, takes as long as
 * they like to construct a perfect run, and reconnects to submit it.
 *
 * Three properties defeat that, and all three are needed:
 *
 *   1. The client submits inputs, not a score. Replaying them server-side
 *      means a claimed score is simply ignored — you cannot assert a number
 *      you did not earn. This turns score forgery into botting.
 *
 *   2. The run's simulated length must match the session's wall-clock length.
 *      A 45-second run submitted from a session that has been open for an hour
 *      did not happen the way it claims.
 *
 *   3. Heartbeats must cover the session continuously. Going offline to do the
 *      work leaves a hole, and the hole is the evidence.
 *
 * Then what is left is a bot that plays in real time, online, at human speed —
 * which the input-plausibility checks below make expensive, and which the
 * clustering tables make bannable once you spot one.
 */
export function validateSubmission(args: {
  rules: GameRules
  session: PlaySessionRecord
  submission: Submission
  now: number
}): ValidationResult {
  const { rules, session, submission, now } = args
  const reasons: string[] = []
  const signals: string[] = []

  if (session.status !== 'active') {
    // A session yields exactly one score. Re-submitting a good run is the
    // cheapest possible attack, so it is refused before anything else.
    return { ok: false, reasons: ['session_not_active'], computedScore: null }
  }
  if (session.gameSlug !== rules.slug) {
    return { ok: false, reasons: ['game_mismatch'], computedScore: null }
  }

  const inputs = submission.inputs
  if (!Array.isArray(inputs)) {
    return { ok: false, reasons: ['inputs_missing'], computedScore: null }
  }

  // ---- input log shape -----------------------------------------------------
  for (let i = 0; i < inputs.length; i++) {
    const ev = inputs[i]
    if (!ev || !Number.isFinite(ev.t) || ev.t < 0 || typeof ev.k !== 'string') {
      reasons.push('input_malformed')
      break
    }
    if (i > 0 && ev.t < inputs[i - 1].t) {
      reasons.push('input_out_of_order')
      break
    }
  }
  if (reasons.length > 0) return { ok: false, reasons, computedScore: null }

  const elapsedMs = now - session.startedAt
  if (elapsedMs < 0) {
    return { ok: false, reasons: ['session_clock_invalid'], computedScore: null }
  }

  const lastInputT = inputs.length > 0 ? inputs[inputs.length - 1].t : 0
  if (lastInputT > rules.maxDurationMs) reasons.push('run_too_long')
  if (lastInputT > elapsedMs + CLOCK_TOLERANCE_MS) {
    // Inputs claim to land after more time than the session has existed for.
    reasons.push('input_beyond_session')
  }

  // ---- input plausibility --------------------------------------------------
  if (exceedsRate(inputs, rules.maxInputsPerSecond)) reasons.push('input_rate_superhuman')
  if (isMetronomic(inputs)) signals.push('timing_too_regular')

  // ---- heartbeat coverage --------------------------------------------------
  if (session.maxGapMs > MAX_HEARTBEAT_GAP_MS) reasons.push('heartbeat_gap')

  const sinceLastBeat = now - session.lastHeartbeatAt
  if (sinceLastBeat > MAX_HEARTBEAT_GAP_MS) reasons.push('heartbeat_stale')

  const expectedBeats = Math.floor(elapsedMs / HEARTBEAT_INTERVAL_MS) - 1
  if (expectedBeats > 0 && session.heartbeatCount < expectedBeats) {
    reasons.push('heartbeat_count_low')
  }

  // ---- the replay ----------------------------------------------------------
  let sim
  try {
    sim = rules.simulate(session.seed, inputs)
  } catch {
    return { ok: false, reasons: [...reasons, 'simulation_error'], computedScore: null }
  }

  if (!Number.isFinite(sim.score) || sim.score < 0) {
    return { ok: false, reasons: [...reasons, 'simulation_invalid'], computedScore: null }
  }
  if (sim.score > rules.maxScore) reasons.push('score_above_ceiling')

  // ---- wall-clock agreement ------------------------------------------------
  const tolerance = Math.max(
    CLOCK_TOLERANCE_MS,
    Math.ceil(sim.durationMs * CLOCK_TOLERANCE_RATIO),
  )
  if (Math.abs(elapsedMs - sim.durationMs) > tolerance) {
    // Either the run took longer in reality than it claims (time spent
    // elsewhere — constructing it), or it claims more time than has passed.
    reasons.push('duration_mismatch')
  }

  // ---- client's own claim --------------------------------------------------
  if (
    typeof submission.claimedScore === 'number' &&
    submission.claimedScore !== sim.score
  ) {
    // Never fatal on its own — a stale client build disagrees innocently — but
    // a wallet that keeps doing this is running a modified client.
    signals.push('claimed_score_mismatch')
  }

  if (reasons.length > 0) return { ok: false, reasons, computedScore: sim.score }
  return { ok: true, score: sim.score, durationMs: sim.durationMs, signals }
}

/** True if any 1-second window holds more inputs than a human could produce. */
export function exceedsRate(inputs: InputEvent[], maxPerSecond: number): boolean {
  if (inputs.length === 0) return false
  let start = 0
  for (let end = 0; end < inputs.length; end++) {
    while (inputs[end].t - inputs[start].t >= RATE_WINDOW_MS) start++
    if (end - start + 1 > maxPerSecond) return true
  }
  return false
}

/**
 * Human input jitters. A script fires on a timer. Comparing the standard
 * deviation of the gaps to their mean separates the two without needing to
 * know anything about the game.
 */
export function isMetronomic(inputs: InputEvent[]): boolean {
  if (inputs.length < TIMING_VARIATION_MIN_EVENTS) return false
  const gaps: number[] = []
  for (let i = 1; i < inputs.length; i++) gaps.push(inputs[i].t - inputs[i - 1].t)

  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length
  if (mean <= 0) return true // every input at the same instant

  const variance =
    gaps.reduce((acc, g) => acc + (g - mean) ** 2, 0) / gaps.length
  return Math.sqrt(variance) / mean < MIN_TIMING_VARIATION
}
