/** A published, versioned rule set. A tournament binds to exactly one. */
export type RulesVersion = {
  version: string
  publishedAt: string
  scoreModel: string
  tieBreaker: string
  eligibility: string[]
}

export type Tournament = {
  slug: string
  name: string
  gameSlug: string
  /** Immutable build hash. Once the event opens, neither this nor the rules change. */
  gameBuildHash: string
  format: string
  rules: RulesVersion
  opensAt: string
  closesAt: string
  status: 'draft' | 'scheduled' | 'open' | 'closed'
  /** Ordering direction for the score model. */
  direction: 'higher' | 'lower'
  /**
   * Null until an operator creates and approves a Prize record AND
   * FEATURE_REAL_PRIZES is on. There is no player-funded pool: prizes are
   * sponsor- or platform-funded and fixed before entry opens.
   */
  prize: { label: string; approvedBy: string } | null
  demo: boolean
}

export type StandingEntry = {
  entryId: string
  /** Public identity. Standings never carry a wallet address. */
  displayName: string
  score: number
  /** Only 'VERIFIED' results are allowed to affect final standings. */
  verification: 'VERIFIED' | 'HELD_FOR_REVIEW' | 'REJECTED'
  submittedAt: string
  /** Set when verification completed. Used as the first tie-break. */
  verifiedAt: string | null
}
