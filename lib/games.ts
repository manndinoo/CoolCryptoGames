export type Game = {
  slug: string
  title: string
  blurb: string
  /** Where the playable build lives. Local builds go in /public/games/<slug>/. */
  playUrl: string
  status: 'live' | 'coming-soon'
  tags: string[]
}

export const games: Game[] = [
  {
    slug: 'example-game',
    title: 'Example Game',
    blurb:
      'Placeholder entry showing how a game is listed. Replace it with your first real build.',
    playUrl: '/games/example-game/index.html',
    status: 'coming-soon',
    tags: ['puzzle', 'demo'],
  },
]

export function getGame(slug: string): Game | undefined {
  return games.find((g) => g.slug === slug)
}
