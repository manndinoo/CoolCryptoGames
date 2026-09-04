import type { StandingEntry, Tournament } from './types'

/**
 * Competition rules. Pure functions with no I/O, so the behaviour the
 * acceptance criteria describe can be tested directly rather than inferred
 * from a page.
 */

export type EligibilityInput = {
  tournament: Tournament
  now: Date
  /** Whether the requester holds a verified platform session. */
  authenticated: boolean
  /** The rules version the player accepted, if any. */
  acceptedRulesVersion: string | null
  /** Any active sanction on the requester's identity. */
  sanctioned: boolean
}

export type Eligibility =
  | { eligible: true }
  | { eligible: false; reason: EligibilityReason }

export type EligibilityReason =
  | 'not_authenticated'
  | 'not_open'
  | 'not_yet_open'
  | 'closed'
  | 'rules_not_accepted'
  | 'rules_version_stale'
  | 'sanctioned'

/**
 * Whether a player may enter.
 *
 * Order matters: authentication is checked first so an anonymous visitor
 * learns nothing about a private event's timing, and the rules-version check
 * is separate from the accepted-at-all check so a player who accepted an
 * earlier version gets a distinct, actionable message.
 */
export function checkEligibility(input: EligibilityInput): Eligibility {
  const { tournament, now, authenticated, acceptedRulesVersion, sanctioned } = input

  if (!authenticated) return { eligible: false, reason: 'not_authenticated' }
  if (sanctioned) return { eligible: false, reason: 'sanctioned' }

  if (tournament.status !== 'open') {
    return { eligible: false, reason: tournament.status === 'closed' ? 'closed' : 'not_open' }
  }

  const opens = Date.parse(tournament.opensAt)
  const closes = Date.parse(tournament.closesAt)
  if (now.getTime() < opens) return { eligible: false, reason: 'not_yet_open' }
  if (now.getTime() >= closes) return { eligible: false, reason: 'closed' }

  if (!acceptedRulesVersion) return { eligible: false, reason: 'rules_not_accepted' }
  if (acceptedRulesVersion !== tournament.rules.version) {
    return { eligible: false, reason: 'rules_version_stale' }
  }

  return { eligible: true }
}

/**
 * Final standings.
 *
 * Two properties the acceptance criteria require:
 *
 *  - only VERIFIED results count. Held and rejected results are dropped
 *    entirely rather than ranked and annotated, so a result under review can
 *    never occupy a placing it might lose.
 *
 *  - the order is deterministic. Score, then earliest verification, then
 *    entry id as a total-order backstop — without that last step two entries
 *    identical on both earlier keys would order by whatever the database
 *    happened to return, and the same data could rank differently twice.
 */
export function rankStandings(
  entries: StandingEntry[],
  direction: 'higher' | 'lower',
): StandingEntry[] {
  return entries
    .filter((e) => e.verification === 'VERIFIED')
    .slice()
    .sort((a, b) => {
      if (a.score !== b.score) {
        return direction === 'higher' ? b.score - a.score : a.score - b.score
      }

      // Earliest verified submission wins the tie.
      const at = a.verifiedAt ? Date.parse(a.verifiedAt) : Number.POSITIVE_INFINITY
      const bt = b.verifiedAt ? Date.parse(b.verifiedAt) : Number.POSITIVE_INFINITY
      if (at !== bt) return at - bt

      // Total-order backstop. Never reached in practice; guarantees stability.
      return a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0
    })
}

/** Results that exist but are not eligible for standings, for a "pending" panel. */
export function heldResults(entries: StandingEntry[]): StandingEntry[] {
  return entries.filter((e) => e.verification === 'HELD_FOR_REVIEW')
}

const REASON_COPY: Record<EligibilityReason, string> = {
  not_authenticated: 'Connect a wallet to enter.',
  not_open: 'This event is not open for entry.',
  not_yet_open: 'Entry has not opened yet.',
  closed: 'Entry has closed.',
  rules_not_accepted: 'Accept the official rules to enter.',
  rules_version_stale: 'The rules have been updated. Review and accept the current version.',
  sanctioned: 'This account cannot enter competitions. Contact support to appeal.',
}

/**
 * Player-facing text. Deliberately a fixed lookup: it says what to do about a
 * refusal without revealing anything about how risk decisions are reached.
 */
export function eligibilityMessage(reason: EligibilityReason): string {
  return REASON_COPY[reason]
}
