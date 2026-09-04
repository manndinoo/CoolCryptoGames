import { describe, expect, it } from 'vitest'
import { rankResults, type BoardResult } from '@/lib/leaderboards/board'

const at = (iso: string) => iso

function result(username: string | null, score: number, achievedAt: string): BoardResult {
  return { username, score, achievedAt }
}

describe('rankResults', () => {
  it('puts the highest score first when higher is better', () => {
    const entries = rankResults(
      [
        result('bee', 10, at('2026-01-01T00:00:00.000Z')),
        result('cat', 30, at('2026-01-01T00:00:00.000Z')),
        result('ant', 20, at('2026-01-01T00:00:00.000Z')),
      ],
      'higher',
    )
    expect(entries.map((e) => e.name)).toEqual(['cat', 'ant', 'bee'])
    expect(entries.map((e) => e.rank)).toEqual([1, 2, 3])
  })

  it('puts the lowest score first when lower is better', () => {
    // Reaction time: 180ms beats 400ms. A board that assumed higher-is-better
    // would put the slowest player on top, which is the bug this guards.
    const entries = rankResults(
      [
        result('slow', 400, at('2026-01-01T00:00:00.000Z')),
        result('fast', 180, at('2026-01-01T00:00:00.000Z')),
      ],
      'lower',
    )
    expect(entries.map((e) => e.name)).toEqual(['fast', 'slow'])
    expect(entries[0].rank).toBe(1)
  })

  it('gives tied scores the same place and skips the next', () => {
    const entries = rankResults(
      [
        result('a', 50, at('2026-01-01T00:00:00.000Z')),
        result('b', 50, at('2026-01-02T00:00:00.000Z')),
        result('c', 40, at('2026-01-03T00:00:00.000Z')),
      ],
      'higher',
    )
    expect(entries.map((e) => e.rank)).toEqual([1, 1, 3])
  })

  it('orders a tie by who got there first, without splitting the place', () => {
    const entries = rankResults(
      [
        result('later', 50, at('2026-01-02T00:00:00.000Z')),
        result('earlier', 50, at('2026-01-01T00:00:00.000Z')),
      ],
      'higher',
    )
    expect(entries.map((e) => e.name)).toEqual(['earlier', 'later'])
    expect(entries.map((e) => e.rank)).toEqual([1, 1])
  })

  it('never renders an address for a player with no username', () => {
    // An account can be authenticated before it is named. The fallback must be
    // a placeholder, because falling back to the wallet address is exactly the
    // leak usernames exist to prevent.
    const entries = rankResults([result(null, 1, at('2026-01-01T00:00:00.000Z'))], 'higher')
    expect(entries[0].name).toBe('Unnamed player')
  })

  it('does not mutate the input order', () => {
    const input = [
      result('a', 1, at('2026-01-01T00:00:00.000Z')),
      result('b', 2, at('2026-01-01T00:00:00.000Z')),
    ]
    rankResults(input, 'higher')
    expect(input.map((r) => r.username)).toEqual(['a', 'b'])
  })

  it('returns nothing for an empty board', () => {
    expect(rankResults([], 'higher')).toEqual([])
  })
})
