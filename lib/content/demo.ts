import type { StandingEntry, Tournament } from '@/lib/tournaments/types'
import type { StreamChannel } from '@/lib/streams/types'

/**
 * Demo catalogue content.
 *
 * This is the seed source. Every record is flagged `demo: true` and the UI
 * surfaces that flag as a visible badge — the Product Bible forbids presenting
 * seeded content as real players, prizes, revenue or live streams.
 *
 * Things deliberately absent, because inventing them would be a lie:
 *  - player counts. `verifiedPlayers` is 0 until stored session rows exist.
 *  - prize values. Prizes need an approved Prize record and FEATURE_REAL_PRIZES.
 *  - live state. Streams are `scheduled` or `offline` until a real one is configured.
 *  - developer earnings. Ledger entries do not exist yet.
 *
 * The concept art shows names, counts and chain logos. None of it is copied here.
 */

export type DemoGame = {
  slug: string
  title: string
  developerSlug: string
  category: string
  blurb: string
  /** Only counts real, verified play sessions. Zero until any exist. */
  verifiedPlayers: number
  /** Whether the server can replay this game's runs and vouch for a score. */
  scoreVerification: 'deterministic-replay' | 'unranked'
  status: 'playable' | 'coming-soon'
  updatedAt: string
  demo: boolean
  /** Two token colours, used to render a placeholder tile — not real key art. */
  art: [string, string]
}

export type DemoDeveloper = {
  slug: string
  name: string
  bio: string
  gameSlugs: string[]
  demo: boolean
}

export const demoGames: DemoGame[] = [
  {
    slug: 'reflex-lab',
    title: 'CCG Reflex Lab',
    developerSlug: 'ccg-platform',
    category: 'Integration demo',
    blurb:
      'A reaction-time test built to exercise the platform: play sessions, scoring, touch and keyboard input, restart, and score verification. Not a flagship release.',
    verifiedPlayers: 0,
    scoreVerification: 'deterministic-replay',
    status: 'playable',
    updatedAt: '2026-09-04',
    demo: false, // Real, shipped by the platform — it just is not a flagship game.
    art: ['#1857FF', '#DFFF00'],
  },
  {
    slug: 'sample-runner',
    title: 'Sample Runner',
    developerSlug: 'placeholder-studio',
    category: 'Arcade',
    blurb:
      'Placeholder catalogue entry showing how a third-party game is listed and reviewed before release.',
    verifiedPlayers: 0,
    scoreVerification: 'unranked',
    status: 'coming-soon',
    updatedAt: '2026-09-01',
    demo: true,
    art: ['#15191F', '#1857FF'],
  },
  {
    slug: 'sample-puzzle',
    title: 'Sample Puzzle',
    developerSlug: 'placeholder-studio',
    category: 'Puzzle',
    blurb:
      'Placeholder catalogue entry. Demonstrates the review-pending state — new builds never publish automatically.',
    verifiedPlayers: 0,
    scoreVerification: 'unranked',
    status: 'coming-soon',
    updatedAt: '2026-08-28',
    demo: true,
    art: ['#1D232B', '#76E65C'],
  },
  {
    slug: 'sample-tactics',
    title: 'Sample Tactics',
    developerSlug: 'second-placeholder-studio',
    category: 'Strategy',
    blurb: 'Placeholder catalogue entry for a second demo developer.',
    verifiedPlayers: 0,
    scoreVerification: 'unranked',
    status: 'coming-soon',
    updatedAt: '2026-08-22',
    demo: true,
    art: ['#15191F', '#FF5A19'],
  },
]

export const demoDevelopers: DemoDeveloper[] = [
  {
    slug: 'ccg-platform',
    name: 'CCG Platform',
    bio: 'The platform team. Publishes integration and reference builds used to validate the SDK.',
    gameSlugs: ['reflex-lab'],
    demo: false,
  },
  {
    slug: 'placeholder-studio',
    name: 'Placeholder Studio',
    bio: 'Demo developer record. Exists to exercise developer pages, build review and the studio dashboard.',
    gameSlugs: ['sample-runner', 'sample-puzzle'],
    demo: true,
  },
  {
    slug: 'second-placeholder-studio',
    name: 'Second Placeholder Studio',
    bio: 'Second demo developer record, used to check directory listing and following.',
    gameSlugs: ['sample-tactics'],
    demo: true,
  },
]

export const demoTournaments: Tournament[] = [
  {
    slug: 'reflex-open-preview',
    name: 'Reflex Open',
    gameSlug: 'reflex-lab',
    // A tournament binds to an exact build. Once it opens, neither this hash
    // nor the rules version changes; a material defect follows the published
    // cancellation rule rather than a silent replacement.
    gameBuildHash: '0'.repeat(64),
    format: 'Solo, best verified run',
    rules: {
      version: '1.0.0',
      publishedAt: '2026-09-01T00:00:00.000Z',
      scoreModel: 'Lowest mean reaction time across five rounds',
      tieBreaker: 'Earliest verified submission wins',
      eligibility: [
        'Entrants must be 18 or over.',
        'One entry per wallet. Multiple wallets operated by one person are a single entrant.',
        'Only results the server has independently verified enter final standings.',
        'Entry is free. There is no fee, deposit, stake, or purchasable attempt.',
      ],
    },
    opensAt: '2026-09-15T18:00:00.000Z',
    closesAt: '2026-09-22T18:00:00.000Z',
    status: 'draft',
    direction: 'lower',
    prize: null,
    demo: true,
  },
]

/**
 * Demo standings. Deliberately includes a held result with a better raw score
 * than the leader, so the "only verified results place" rule is visible in the
 * running product rather than only in a test.
 */
export const demoStandings: Record<string, StandingEntry[]> = {
  'reflex-open-preview': [
    {
      entryId: 'demo-1',
      wallet: 'DemoWa11et1111111111111111111111111111111111',
      score: 214,
      verification: 'VERIFIED',
      submittedAt: '2026-09-16T10:02:00.000Z',
      verifiedAt: '2026-09-16T10:02:30.000Z',
    },
    {
      entryId: 'demo-2',
      wallet: 'DemoWa11et2222222222222222222222222222222222',
      score: 231,
      verification: 'VERIFIED',
      submittedAt: '2026-09-16T11:40:00.000Z',
      verifiedAt: '2026-09-16T11:40:20.000Z',
    },
    {
      entryId: 'demo-3',
      wallet: 'DemoWa11et3333333333333333333333333333333333',
      score: 118,
      verification: 'HELD_FOR_REVIEW',
      submittedAt: '2026-09-16T12:15:00.000Z',
      verifiedAt: null,
    },
  ],
}

/**
 * Channels.
 *
 * Two source kinds, matching the streaming rollout: an approved creator
 * broadcasting through their own provider (which is how a camera-over-game
 * stream works today — their encoder composites it), and a CCG-hosted native
 * channel (which is the platform-phase capability and stays flagged off).
 */
export const demoChannels: StreamChannel[] = [
  {
    slug: 'ccg-official',
    title: 'CCG official channel',
    broadcaster: 'Cool Crypto Games',
    approved: true,
    state: 'scheduled',
    scheduledFor: '2026-09-15T19:00:00.000Z',
    // No provider is configured, so there is no URL to frame and nothing here
    // can broadcast. A scheduled slot is not a live one.
    source: null,
    demo: true,
  },
  {
    slug: 'approved-creator-preview',
    title: 'Reflex Lab run — creator broadcast',
    broadcaster: 'Approved Creator',
    approved: true,
    state: 'offline',
    scheduledFor: '2026-09-22T17:00:00.000Z',
    source: null,
    demo: true,
  },
  {
    slug: 'native-preview',
    title: 'Native broadcast preview',
    broadcaster: 'CCG Platform',
    approved: true,
    state: 'offline',
    scheduledFor: null,
    // Composition is modelled and rendered even while distribution is off, so
    // the layout is real code rather than a promise.
    source: {
      kind: 'native',
      layout: 'game-primary',
      gameSlug: 'reflex-lab',
      hasCamera: true,
    },
    demo: true,
  },
]

export function getDemoChannel(slug: string): StreamChannel | undefined {
  return demoChannels.find((c) => c.slug === slug)
}

export function getDemoTournament(slug: string): Tournament | undefined {
  return demoTournaments.find((t) => t.slug === slug)
}

export function getDemoStandings(slug: string): StandingEntry[] {
  return demoStandings[slug] ?? []
}

export function getDemoGame(slug: string): DemoGame | undefined {
  return demoGames.find((g) => g.slug === slug)
}

export function getDemoDeveloper(slug: string): DemoDeveloper | undefined {
  return demoDevelopers.find((d) => d.slug === slug)
}
