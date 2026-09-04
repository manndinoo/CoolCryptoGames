import { describe, expect, it } from 'vitest'
import {
  exceedsRate,
  isMetronomic,
  validateSubmission,
} from '@/lib/anticheat/validate'
import type { GameRules, InputEvent, PlaySessionRecord } from '@/lib/anticheat/types'

/** Toy deterministic game: each 'hit' is a point, run length is the last input. */
const rules: GameRules = {
  slug: 'example-game',
  maxDurationMs: 120_000,
  maxScore: 10_000,
  maxInputsPerSecond: 12,
  simulate(_seed, inputs) {
    return {
      score: inputs.filter((i) => i.k === 'hit').length,
      durationMs: inputs.length ? inputs[inputs.length - 1].t : 0,
    }
  },
}

const START = 1_000_000

function session(over: Partial<PlaySessionRecord> = {}): PlaySessionRecord {
  return {
    id: 'sess-1',
    gameSlug: 'example-game',
    seed: 'seed-abc',
    startedAt: START,
    lastHeartbeatAt: START + 29_000,
    heartbeatCount: 6,
    maxGapMs: 5_000,
    status: 'active',
    ...over,
  }
}

/** A believable 30-second run: jittered inputs, roughly 2/second. */
function humanRun(durationMs = 30_000): InputEvent[] {
  const out: InputEvent[] = []
  let t = 120
  let i = 0
  while (t < durationMs) {
    out.push({ t: Math.round(t), k: i % 3 === 0 ? 'move' : 'hit' })
    t += 380 + Math.sin(i * 12.9898) * 140
    i++
  }
  return out
}

describe('validateSubmission', () => {
  it('accepts an honest run and scores it from the replay', () => {
    const inputs = humanRun()
    const res = validateSubmission({
      rules,
      session: session(),
      submission: { inputs },
      now: START + 30_000,
    })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.score).toBe(inputs.filter((i) => i.k === 'hit').length)
      expect(res.signals).not.toContain('timing_too_regular')
    }
  })

  it('ignores the score the client claims and uses its own', () => {
    const inputs = humanRun()
    const res = validateSubmission({
      rules,
      session: session(),
      submission: { inputs, claimedScore: 999_999 },
      now: START + 30_000,
    })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.score).toBeLessThan(200)
      expect(res.signals).toContain('claimed_score_mismatch')
    }
  })

  it('rejects a run built offline and submitted late', () => {
    // The attack: disconnect, spend ten minutes constructing a perfect input
    // log, reconnect and submit it as a 30-second run.
    const res = validateSubmission({
      rules,
      session: session({ maxGapMs: 600_000, lastHeartbeatAt: START + 5_000 }),
      submission: { inputs: humanRun() },
      now: START + 630_000,
    })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.reasons).toContain('heartbeat_gap')
      expect(res.reasons).toContain('duration_mismatch')
    }
  })

  it('rejects a run whose length disagrees with the wall clock', () => {
    const res = validateSubmission({
      rules,
      session: session(),
      submission: { inputs: humanRun(30_000) },
      now: START + 90_000, // session open three times longer than the run
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reasons).toContain('duration_mismatch')
  })

  it('rejects inputs timestamped past the life of the session', () => {
    const res = validateSubmission({
      rules,
      session: session(),
      submission: { inputs: [{ t: 500_000, k: 'hit' }] },
      now: START + 1_000,
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reasons).toContain('input_beyond_session')
  })

  it('rejects a superhuman input rate', () => {
    const inputs: InputEvent[] = []
    for (let i = 0; i < 400; i++) inputs.push({ t: i * 10, k: 'hit' }) // 100/sec
    const res = validateSubmission({
      rules,
      session: session({ lastHeartbeatAt: START + 3_000, heartbeatCount: 0, maxGapMs: 0 }),
      submission: { inputs },
      now: START + 4_000,
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reasons).toContain('input_rate_superhuman')
  })

  it('refuses a second submission for the same session', () => {
    // Replaying one good run forever is the cheapest attack there is.
    const res = validateSubmission({
      rules,
      session: session({ status: 'submitted' }),
      submission: { inputs: humanRun() },
      now: START + 30_000,
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reasons).toEqual(['session_not_active'])
  })

  it('rejects out-of-order input timestamps', () => {
    const res = validateSubmission({
      rules,
      session: session(),
      submission: { inputs: [{ t: 900, k: 'hit' }, { t: 400, k: 'hit' }] },
      now: START + 1_000,
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reasons).toContain('input_out_of_order')
  })

  it('rejects a submission for a different game than the session opened', () => {
    const res = validateSubmission({
      rules,
      session: session({ gameSlug: 'other-game' }),
      submission: { inputs: humanRun() },
      now: START + 30_000,
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reasons).toEqual(['game_mismatch'])
  })

  it('flags a missing heartbeat trail even when timing looks fine', () => {
    const res = validateSubmission({
      rules,
      session: session({ heartbeatCount: 0, maxGapMs: 0 }),
      submission: { inputs: humanRun() },
      now: START + 30_000,
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reasons).toContain('heartbeat_count_low')
  })
})

describe('exceedsRate', () => {
  it('passes a human rate', () => {
    expect(exceedsRate(humanRun(), 12)).toBe(false)
  })

  it('catches a burst inside one window', () => {
    const inputs = [
      ...Array.from({ length: 20 }, (_, i) => ({ t: 5_000 + i * 5, k: 'hit' })),
    ]
    expect(exceedsRate(inputs, 12)).toBe(true)
  })

  it('allows a high total spread across many windows', () => {
    const inputs = Array.from({ length: 200 }, (_, i) => ({ t: i * 200, k: 'hit' }))
    expect(exceedsRate(inputs, 12)).toBe(false)
  })
})

describe('isMetronomic', () => {
  it('flags perfectly regular timing as scripted', () => {
    const inputs = Array.from({ length: 60 }, (_, i) => ({ t: i * 250, k: 'hit' }))
    expect(isMetronomic(inputs)).toBe(true)
  })

  it('does not flag a jittery human', () => {
    expect(isMetronomic(humanRun())).toBe(false)
  })

  it('stays quiet on samples too small to mean anything', () => {
    const inputs = Array.from({ length: 5 }, (_, i) => ({ t: i * 250, k: 'hit' }))
    expect(isMetronomic(inputs)).toBe(false)
  })
})
