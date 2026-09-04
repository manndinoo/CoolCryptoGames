import { describe, expect, it } from 'vitest'
import { checkEligibility, rankStandings, heldResults } from '@/lib/tournaments/rules'
import type { StandingEntry, Tournament } from '@/lib/tournaments/types'

const tournament: Tournament = {
  slug: 'test-open',
  name: 'Reflex Open',
  gameSlug: 'zero-signal',
  gameBuildHash: 'a'.repeat(64),
  format: 'Solo, best verified run',
  rules: {
    version: '1.0.0',
    publishedAt: '2026-09-01T00:00:00.000Z',
    scoreModel: 'Lowest mean reaction time',
    tieBreaker: 'Earliest verified submission wins',
    eligibility: ['18+'],
  },
  opensAt: '2026-09-15T18:00:00.000Z',
  closesAt: '2026-09-22T18:00:00.000Z',
  status: 'open',
  direction: 'lower',
  prize: null,
  demo: true,
}

const DURING = new Date('2026-09-18T12:00:00.000Z')

function eligibility(over: Partial<Parameters<typeof checkEligibility>[0]> = {}) {
  return checkEligibility({
    tournament,
    now: DURING,
    authenticated: true,
    acceptedRulesVersion: '1.0.0',
    sanctioned: false,
    ...over,
  })
}

describe('checkEligibility', () => {
  it('admits an authenticated player who accepted the current rules', () => {
    expect(eligibility()).toEqual({ eligible: true })
  })

  it('requires authentication', () => {
    expect(eligibility({ authenticated: false })).toEqual({
      eligible: false,
      reason: 'not_authenticated',
    })
  })

  it('checks authentication before anything else', () => {
    // An anonymous visitor should not learn a private event's timing from a
    // refusal message.
    expect(
      eligibility({ authenticated: false, tournament: { ...tournament, status: 'draft' } }),
    ).toEqual({ eligible: false, reason: 'not_authenticated' })
  })

  it('requires rules acceptance', () => {
    expect(eligibility({ acceptedRulesVersion: null })).toEqual({
      eligible: false,
      reason: 'rules_not_accepted',
    })
  })

  it('rejects acceptance of a superseded rules version', () => {
    expect(eligibility({ acceptedRulesVersion: '0.9.0' })).toEqual({
      eligible: false,
      reason: 'rules_version_stale',
    })
  })

  it('rejects entry before opening', () => {
    expect(eligibility({ now: new Date('2026-09-14T00:00:00.000Z') })).toEqual({
      eligible: false,
      reason: 'not_yet_open',
    })
  })

  it('rejects entry after closing', () => {
    expect(eligibility({ now: new Date('2026-09-23T00:00:00.000Z') })).toEqual({
      eligible: false,
      reason: 'closed',
    })
  })

  it('rejects entry at the exact closing instant', () => {
    expect(eligibility({ now: new Date(tournament.closesAt) })).toEqual({
      eligible: false,
      reason: 'closed',
    })
  })

  it('rejects a tournament that is not open', () => {
    expect(eligibility({ tournament: { ...tournament, status: 'draft' } })).toEqual({
      eligible: false,
      reason: 'not_open',
    })
    expect(eligibility({ tournament: { ...tournament, status: 'closed' } })).toEqual({
      eligible: false,
      reason: 'closed',
    })
  })

  it('rejects a sanctioned account', () => {
    expect(eligibility({ sanctioned: true })).toEqual({ eligible: false, reason: 'sanctioned' })
  })
})

function entry(over: Partial<StandingEntry>): StandingEntry {
  return {
    entryId: 'e1',
    displayName: 'PlayerOne',
    score: 100,
    verification: 'VERIFIED',
    submittedAt: '2026-09-18T10:00:00.000Z',
    verifiedAt: '2026-09-18T10:05:00.000Z',
    ...over,
  }
}

describe('rankStandings', () => {
  it('keeps only verified results out of final standings', () => {
    const ranked = rankStandings(
      [
        entry({ entryId: 'a', score: 50 }),
        entry({ entryId: 'b', score: 10, verification: 'HELD_FOR_REVIEW' }),
        entry({ entryId: 'c', score: 20, verification: 'REJECTED' }),
      ],
      'lower',
    )
    // The held result has the best raw score and must still not place.
    expect(ranked.map((e) => e.entryId)).toEqual(['a'])
  })

  it('orders by score in the direction the score model declares', () => {
    const entries = [
      entry({ entryId: 'a', score: 30 }),
      entry({ entryId: 'b', score: 10 }),
      entry({ entryId: 'c', score: 20 }),
    ]
    expect(rankStandings(entries, 'lower').map((e) => e.entryId)).toEqual(['b', 'c', 'a'])
    expect(rankStandings(entries, 'higher').map((e) => e.entryId)).toEqual(['a', 'c', 'b'])
  })

  it('breaks a score tie on earliest verification', () => {
    const ranked = rankStandings(
      [
        entry({ entryId: 'late', score: 10, verifiedAt: '2026-09-18T12:00:00.000Z' }),
        entry({ entryId: 'early', score: 10, verifiedAt: '2026-09-18T09:00:00.000Z' }),
      ],
      'lower',
    )
    expect(ranked.map((e) => e.entryId)).toEqual(['early', 'late'])
  })

  it('is deterministic when score and verification time both tie', () => {
    // Without a total-order backstop these would rank by input order, so the
    // same data could produce two different standings.
    const a = entry({ entryId: 'aaa', score: 10, verifiedAt: '2026-09-18T09:00:00.000Z' })
    const b = entry({ entryId: 'bbb', score: 10, verifiedAt: '2026-09-18T09:00:00.000Z' })
    expect(rankStandings([a, b], 'lower').map((e) => e.entryId)).toEqual(['aaa', 'bbb'])
    expect(rankStandings([b, a], 'lower').map((e) => e.entryId)).toEqual(['aaa', 'bbb'])
  })

  it('does not mutate the input array', () => {
    const entries = [entry({ entryId: 'a', score: 30 }), entry({ entryId: 'b', score: 10 })]
    rankStandings(entries, 'lower')
    expect(entries.map((e) => e.entryId)).toEqual(['a', 'b'])
  })

  it('sorts a verified entry missing verifiedAt last among its ties', () => {
    const ranked = rankStandings(
      [
        entry({ entryId: 'novt', score: 10, verifiedAt: null }),
        entry({ entryId: 'withvt', score: 10, verifiedAt: '2026-09-18T09:00:00.000Z' }),
      ],
      'lower',
    )
    expect(ranked.map((e) => e.entryId)).toEqual(['withvt', 'novt'])
  })
})

describe('heldResults', () => {
  it('surfaces results under review separately from standings', () => {
    const held = heldResults([
      entry({ entryId: 'a' }),
      entry({ entryId: 'b', verification: 'HELD_FOR_REVIEW' }),
      entry({ entryId: 'c', verification: 'REJECTED' }),
    ])
    expect(held.map((e) => e.entryId)).toEqual(['b'])
  })
})
