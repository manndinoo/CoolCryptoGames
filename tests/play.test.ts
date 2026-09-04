import { describe, expect, it } from 'vitest'
import {
  capabilityPermits,
  issueCapability,
  readCapability,
  type PlayCapability,
} from '@/lib/play/capability'
import { isFromFrame, parseGameMessage, PROTOCOL_VERSION } from '@/lib/play/protocol'
import { HUMAN_FLOOR_MS, ROUNDS, roundDelays, simulate } from '@/lib/games/reflex-lab/engine'

const SESSION = 'sess-1'

function capability(over: Partial<PlayCapability> = {}): PlayCapability {
  return {
    capabilityId: 'cap-1',
    matchId: 'match-1',
    playSessionId: SESSION,
    gameSlug: 'reflex-lab',
    buildHash: 'a'.repeat(64),
    actions: ['score', 'telemetry'],
    ...over,
  }
}

describe('play capability', () => {
  it('round-trips through issue and read', async () => {
    const token = await issueCapability(capability())
    expect(await readCapability(token)).toMatchObject({
      gameSlug: 'reflex-lab',
      playSessionId: SESSION,
    })
  })

  it('rejects a tampered token', async () => {
    const token = await issueCapability(capability())
    expect(await readCapability(`${token}x`)).toBeNull()
  })

  it('rejects a missing token', async () => {
    expect(await readCapability(undefined)).toBeNull()
  })

  it('carries no player identity', async () => {
    // The frame runs untrusted code. It learns that a match is being played,
    // not who is playing it.
    const token = await issueCapability(capability())
    const decoded = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
    ) as Record<string, unknown>

    expect(Object.keys(decoded)).not.toContain('wallet')
    expect(Object.keys(decoded)).not.toContain('username')
    expect(JSON.stringify(decoded)).not.toMatch(/wallet|username|session_id/i)
  })
})

describe('capabilityPermits', () => {
  it('permits the action it was scoped to', () => {
    expect(
      capabilityPermits(capability(), {
        gameSlug: 'reflex-lab',
        buildHash: 'a'.repeat(64),
        action: 'score',
      }),
    ).toBe(true)
  })

  it('refuses an action outside its scope', () => {
    expect(
      capabilityPermits(capability(), {
        gameSlug: 'reflex-lab',
        buildHash: 'a'.repeat(64),
        action: 'save',
      }),
    ).toBe(false)
  })

  it('refuses a different game', () => {
    expect(
      capabilityPermits(capability(), {
        gameSlug: 'other-game',
        buildHash: 'a'.repeat(64),
        action: 'score',
      }),
    ).toBe(false)
  })

  it('refuses a different build of the same game', () => {
    // A tournament binds to an exact build. "This game" and "the version the
    // event ran on" are not the same claim.
    expect(
      capabilityPermits(capability(), {
        gameSlug: 'reflex-lab',
        buildHash: 'b'.repeat(64),
        action: 'score',
      }),
    ).toBe(false)
  })
})

describe('parseGameMessage', () => {
  const expected = { playSessionId: SESSION }

  function score(over: Record<string, unknown> = {}) {
    return {
      type: 'SCORE_SUBMIT',
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'r1',
      playSessionId: SESSION,
      inputs: [{ t: 100, k: 'press' }],
      ...over,
    }
  }

  it('accepts a well-formed score submission', () => {
    const res = parseGameMessage(score(), expected)
    expect(res.ok).toBe(true)
  })

  it('rejects a non-object', () => {
    expect(parseGameMessage('hello', expected)).toEqual({ ok: false, reason: 'not_an_object' })
    expect(parseGameMessage(null, expected)).toEqual({ ok: false, reason: 'not_an_object' })
  })

  it('rejects an unknown message type rather than forwarding it', () => {
    // An allow-list is the point: a protocol that passes unknown types through
    // grows its surface every time a game invents a message.
    expect(parseGameMessage(score({ type: 'DO_ANYTHING' }), expected)).toEqual({
      ok: false,
      reason: 'unknown_type',
    })
  })

  it('rejects a protocol version mismatch', () => {
    expect(parseGameMessage(score({ protocolVersion: '99' }), expected)).toEqual({
      ok: false,
      reason: 'protocol_mismatch',
    })
  })

  it('rejects a submission for another play session', () => {
    // A frame must not submit against a session it was not launched for, even
    // if it learns that session's id.
    expect(parseGameMessage(score({ playSessionId: 'someone-else' }), expected)).toEqual({
      ok: false,
      reason: 'session_mismatch',
    })
  })

  it('rejects malformed inputs', () => {
    expect(parseGameMessage(score({ inputs: 'nope' }), expected)).toMatchObject({
      reason: 'inputs_invalid',
    })
    expect(parseGameMessage(score({ inputs: [{ t: -1, k: 'press' }] }), expected)).toMatchObject({
      reason: 'inputs_invalid',
    })
    expect(parseGameMessage(score({ inputs: [{ t: 1 }] }), expected)).toMatchObject({
      reason: 'inputs_invalid',
    })
  })

  it('rejects an oversized input log', () => {
    const inputs = Array.from({ length: 50_001 }, (_, i) => ({ t: i, k: 'press' }))
    expect(parseGameMessage(score({ inputs }), expected)).toMatchObject({
      reason: 'inputs_too_large',
    })
  })

  it('rejects a missing or oversized request id', () => {
    expect(parseGameMessage(score({ requestId: '' }), expected)).toMatchObject({
      reason: 'bad_request_id',
    })
    expect(parseGameMessage(score({ requestId: 'x'.repeat(200) }), expected)).toMatchObject({
      reason: 'bad_request_id',
    })
  })

  it('drops a claimed score that is not a number', () => {
    const res = parseGameMessage(score({ claimedScore: 'lots' }), expected)
    expect(res.ok && res.message.type === 'SCORE_SUBMIT' && res.message.claimedScore).toBe(
      undefined,
    )
  })
})

describe('isFromFrame', () => {
  it('accepts the frame window and rejects anything else', () => {
    // event.origin is "null" for a sandboxed frame without allow-same-origin,
    // so window identity is what establishes the sender.
    const frame = {} as Window
    const other = {} as Window
    expect(isFromFrame(frame, frame)).toBe(true)
    expect(isFromFrame(other, frame)).toBe(false)
    expect(isFromFrame(null, frame)).toBe(false)
    expect(isFromFrame(frame, null)).toBe(false)
  })
})

describe('reflex-lab engine', () => {
  const SEED = 'seed-abc'

  /** A believable run: each press lands `reaction` ms after its target. */
  function run(seed: string, reactions: number[]) {
    const delays = roundDelays(seed)
    const inputs: { t: number; k: string }[] = []
    let roundStart = 0
    for (let i = 0; i < reactions.length; i++) {
      const t = roundStart + delays[i] + reactions[i]
      inputs.push({ t, k: 'press' })
      roundStart = t
    }
    return inputs
  }

  it('produces the same delays for the same seed', () => {
    expect(roundDelays(SEED)).toEqual(roundDelays(SEED))
  })

  it('produces different delays for different seeds', () => {
    expect(roundDelays('one')).not.toEqual(roundDelays('two'))
  })

  it('scores a plausible run as the mean reaction time', () => {
    const result = simulate(SEED, run(SEED, [240, 260, 220, 300, 230]))
    expect(result.score).toBe(250)
    expect(result.reactions).toEqual([240, 260, 220, 300, 230])
  })

  it('replays identically every time', () => {
    const inputs = run(SEED, [240, 260, 220, 300, 230])
    expect(simulate(SEED, inputs)).toEqual(simulate(SEED, inputs))
  })

  it('scores differently against a different seed', () => {
    // The same presses against different delays are a different run, which is
    // what stops a recorded input log being replayed into a new session.
    const inputs = run(SEED, [240, 260, 220, 300, 230])
    expect(() => simulate('another-seed', inputs)).toThrow()
  })

  it('rejects a press before the target appeared', () => {
    const inputs = run(SEED, [240, 260, 220, 300, 230])
    inputs[2].t -= 500
    expect(() => simulate(SEED, inputs)).toThrow(/before the target/)
  })

  it('rejects a superhuman reaction', () => {
    expect(() => simulate(SEED, run(SEED, [240, 260, HUMAN_FLOOR_MS - 1, 300, 230]))).toThrow(
      /human floor/,
    )
  })

  it('rejects the wrong number of presses', () => {
    expect(() => simulate(SEED, run(SEED, [240, 260]))).toThrow(/expected 5 presses/)
  })

  it('ignores input keys that are not presses', () => {
    const inputs = run(SEED, [240, 260, 220, 300, 230])
    inputs.push({ t: 99_999, k: 'move' })
    expect(simulate(SEED, inputs).score).toBe(250)
  })

  it('reports duration as the last press', () => {
    const inputs = run(SEED, [240, 260, 220, 300, 230])
    expect(simulate(SEED, inputs).durationMs).toBe(inputs[ROUNDS - 1].t)
  })
})
