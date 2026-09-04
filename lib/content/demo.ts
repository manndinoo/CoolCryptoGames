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
    facts: [
      { label: 'Levels', value: '50 across five regions' },
      { label: 'Play', value: 'Portrait, touch or mouse' },
      { label: 'Session', value: 'Single player, saves locally' },
      { label: 'Engine', value: 'Deterministic — same seed, same board' },
    ],
  },
]

export const demoDevelopers: DemoDeveloper[] = [
  {
    slug: 'ccg-platform',
    name: 'CCG Platform',
    bio: 'The platform team. Publishes integration and reference builds used to validate the SDK.',
    gameSlugs: ['zero-signal', 'road-to-bonded'],
    demo: false,
  },
]

/**
 * Events.
 *
 * Empty. The one event here was a demonstration bound to CCG Reflex Lab, and
 * that game has been removed from the catalogue — a tournament pointing at a
 * game nobody can open is a broken record, not a preview. The competition
 * system itself is unchanged and tested; it is waiting on a real event.
 *
 * A tournament binds to an exact build hash at open time and neither that hash
 * nor its rules version changes afterwards, so the next entry here has to be a
 * genuine event rather than a placeholder edited into one later.
 */
export const demoTournaments: Tournament[] = []

/**
 * Standings, by event slug.
 *
 * Empty, because there are no events. The seeded rows that used to live here
 * were invented players on an invented event; with the event gone they would
 * be fabricated results attached to nothing.
 */
export const demoStandings: Record<string, StandingEntry[]> = {}

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
      gameSlug: 'zero-signal',
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
