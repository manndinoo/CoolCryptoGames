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

export type DemoTournament = {
  slug: string
  name: string
  gameSlug: string
  format: string
  /** Rules are versioned; a tournament binds to one version and one build. */
  rulesVersion: string
  scoreModel: string
  tieBreaker: string
  opensAt: string
  closesAt: string
  status: 'draft' | 'scheduled' | 'open' | 'closed'
  /** No prize until an operator creates and approves a Prize record. */
  prize: null
  demo: boolean
}

export type DemoStream = {
  slug: string
  title: string
  scheduledFor: string
  /** Never 'live' without a configured, active provider stream. */
  state: 'scheduled' | 'offline'
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

export const demoTournaments: DemoTournament[] = [
  {
    slug: 'reflex-open-preview',
    name: 'Reflex Open',
    gameSlug: 'reflex-lab',
    format: 'Solo, best verified run',
    rulesVersion: '1.0.0',
    scoreModel: 'Lowest mean reaction time across five rounds',
    tieBreaker: 'Earliest verified submission wins',
    opensAt: '2026-09-15T18:00:00.000Z',
    closesAt: '2026-09-22T18:00:00.000Z',
    status: 'draft',
    prize: null,
    demo: true,
  },
]

export const demoStreams: DemoStream[] = [
  {
    slug: 'platform-preview',
    title: 'Platform preview stream',
    scheduledFor: '2026-09-15T19:00:00.000Z',
    state: 'offline',
    demo: true,
  },
]

export function getDemoGame(slug: string): DemoGame | undefined {
  return demoGames.find((g) => g.slug === slug)
}

export function getDemoDeveloper(slug: string): DemoDeveloper | undefined {
  return demoDevelopers.find((d) => d.slug === slug)
}
