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
  /**
   * Which way the score runs. Reaction time is better when it is lower; almost
   * everything else is better when it is higher, and a board that assumes one
   * of those universally puts the worst player on top of the other.
   */
  scoreDirection: 'higher' | 'lower'
  /** Unit shown beside a score on a board. Empty for a plain point total. */
  scoreUnit: string
  status: 'playable' | 'coming-soon'
  updatedAt: string
  demo: boolean
  /** Two token colours, used to render a placeholder tile — not real key art. */
  art: [string, string]
  /**
   * Path to a cover image. These are real screenshots captured from the game
   * itself, not illustrations of one — a card should show what a player is
   * actually about to open. Null for entries with nothing to screenshot.
   */
  cover: string | null
  /** Gallery shots, captured from the running game. */
  screenshots: string[]
  /**
   * How the game is played, and so the shape of its captures. The gallery
   * frames every tile to this: a landscape brawler squeezed into the portrait
   * frame the phone games use shows a sliver of the middle of the arena.
   */
  orientation: 'portrait' | 'landscape'
  /** Short factual details for the page. Nothing here is a marketing claim. */
  facts: { label: string; value: string }[]
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
    slug: 'zero-signal',
    title: 'ZERO SIGNAL',
    developerSlug: 'ccg-platform',
    category: 'Arcade',
    blurb:
      'One thumb, no brakes. The ball drifts sideways and a tap reverses it — thread every gate, clear a level, and the world changes under you. Six worlds, power-ups that get rarer the deeper you go, and one free Revive a day.',
    // Stays 0 until the game has verified sessions to count.
    verifiedPlayers: 0,
    // The run advances on a variable frame delta and an unseeded RNG, so it is
    // not reproducible from an input log and the server cannot replay it. This
    // site will not call a score verified that it cannot reproduce.
    scoreVerification: 'unranked',
    scoreDirection: 'higher',
    scoreUnit: 'pts',
    status: 'playable',
    updatedAt: '2026-09-04',
    demo: false,
    art: ['#19072D', '#FF3F92'],
    cover: '/games/zero-signal/cover.jpg',
    screenshots: [
      '/games/zero-signal/shots/3-play.jpg',
      '/games/zero-signal/shots/1-title.jpg',
      '/games/zero-signal/shots/2-run.jpg',
    ],
    orientation: 'portrait',
    facts: [
      { label: 'Worlds', value: 'Six, cycling themes' },
      { label: 'Play', value: 'One tap or one key' },
      { label: 'Session', value: 'Single player, saves locally' },
      { label: 'Purchases', value: 'Locked — chips and credits are in-game only' },
    ],
  },
  {
    slug: 'road-to-bonded',
    title: 'Road to Bonded',
    developerSlug: 'ccg-platform',
    category: 'Puzzle',
    blurb:
      'A portrait-first strategic match-3 arcade game. Launch a coin, build volume, survive dips and climb the bonding curve across fifty levels.',
    verifiedPlayers: 0,
    // The engine is deterministic and replays are byte-identical, so verified
    // scoring is reachable — but it needs a server-side port of the engine
    // before a result can be vouched for. Unranked until that exists.
    scoreVerification: 'unranked',
    scoreDirection: 'higher',
    scoreUnit: 'pts',
    status: 'playable',
    updatedAt: '2026-09-04',
    demo: false,
    art: ['#1857FF', '#DFFF00'],
    cover: '/games/road-to-bonded/cover.jpg',
    screenshots: [
      '/games/road-to-bonded/shots/2-board.jpg',
      '/games/road-to-bonded/shots/1-roadmap.jpg',
      '/games/road-to-bonded/shots/3-bonded.jpg',
      '/games/road-to-bonded/shots/4-midlevel.jpg',
      '/games/road-to-bonded/shots/5-complete.jpg',
    ],
    orientation: 'portrait',
    facts: [
      { label: 'Levels', value: '50 across five regions' },
      { label: 'Play', value: 'Portrait, touch or mouse' },
      { label: 'Session', value: 'Single player, saves locally' },
      { label: 'Engine', value: 'Deterministic — same seed, same board' },
    ],
  },
  {
    slug: 'reflex-lab',
    title: 'CCG Reflex Lab',
    developerSlug: 'ccg-platform',
    category: 'Integration demo',
    blurb:
      'A reaction-time test built to exercise the platform: play sessions, scoring, touch and keyboard input, restart, and score verification. Not a flagship release.',
    verifiedPlayers: 0,
    scoreVerification: 'deterministic-replay',
    scoreDirection: 'lower',
    scoreUnit: 'ms',
    status: 'playable',
    updatedAt: '2026-09-04',
    demo: false, // Real, shipped by the platform — it just is not a flagship game.
    art: ['#1857FF', '#DFFF00'],
    cover: '/games/reflex-lab/cover.jpg',
    screenshots: [
      '/games/reflex-lab/shots/2-go.jpg',
      '/games/reflex-lab/shots/3-run.jpg',
      '/games/reflex-lab/shots/1-idle.jpg',
    ],
    orientation: 'portrait',
    facts: [
      { label: 'Rounds', value: 'Five per run' },
      { label: 'Play', value: 'Tap or press space' },
      { label: 'Scoring', value: 'Mean reaction time, lower is better' },
      { label: 'Engine', value: 'Replayed server-side from your inputs' },
    ],
  },
  {
    slug: 'signal-brawl',
    title: 'Signal Brawl',
    developerSlug: 'ccg-platform',
    category: 'Fighting',
    blurb:
      'A stick-figure platform brawler. You against three CPU rivals, three lives each, ninety seconds. Light combos, charged heavies, dashes, guards and a Signal Surge you earn by landing hits — plus blasters, staves, gravity hammers and plasma bombs that drop mid-fight. Six arenas, each with its own hazard.',
    // Stays 0 until the game has verified sessions to count.
    verifiedPlayers: 0,
    // The match runs on a variable frame delta with unseeded RNG driving pickup
    // spawns, hazards and three CPU opponents, so it cannot be reproduced from
    // an input log. This site will not call a score verified that it cannot
    // replay.
    scoreVerification: 'unranked',
    scoreDirection: 'higher',
    scoreUnit: 'pts',
    status: 'playable',
    updatedAt: '2026-09-04',
    demo: false,
    art: ['#050811', '#FF326F'],
    cover: '/games/signal-brawl/cover.jpg',
    screenshots: [
      '/games/signal-brawl/shots/2-brawl.jpg',
      '/games/signal-brawl/shots/1-title.jpg',
      '/games/signal-brawl/shots/3-reactor.jpg',
      '/games/signal-brawl/shots/4-rooftop.jpg',
      '/games/signal-brawl/shots/5-result.jpg',
    ],
    orientation: 'landscape',
    facts: [
      { label: 'Arenas', value: 'Six, unlocked by winning' },
      { label: 'Play', value: 'Landscape, keyboard or touch' },
      { label: 'Match', value: 'Four fighters, three lives, 90 seconds' },
      { label: 'Session', value: 'Single player, progress saves locally' },
    ],
  },
]

export const demoDevelopers: DemoDeveloper[] = [
  {
    slug: 'ccg-platform',
    name: 'CCG Platform',
    bio: 'The platform team. Publishes integration and reference builds used to validate the SDK.',
    gameSlugs: ['zero-signal', 'road-to-bonded', 'signal-brawl', 'reflex-lab'],
    demo: false,
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
      displayName: 'ReflexKing',
      score: 214,
      verification: 'VERIFIED',
      submittedAt: '2026-09-16T10:02:00.000Z',
      verifiedAt: '2026-09-16T10:02:30.000Z',
    },
    {
      entryId: 'demo-2',
      displayName: 'QuickDraw',
      score: 231,
      verification: 'VERIFIED',
      submittedAt: '2026-09-16T11:40:00.000Z',
      verifiedAt: '2026-09-16T11:40:20.000Z',
    },
    {
      entryId: 'demo-3',
      displayName: 'FastHands',
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
