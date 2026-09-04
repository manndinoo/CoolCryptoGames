import type { MetadataRoute } from 'next'
import { demoDevelopers, demoGames, demoTournaments } from '@/lib/content/demo'
import { site } from '@/site.config'

export default function sitemap(): MetadataRoute.Sitemap {
  const staticRoutes = ['', '/games', '/tournaments', '/live', '/developers', '/leaderboards']

  return [
    ...staticRoutes.map((path) => ({ url: `${site.url}${path}`, priority: path === '' ? 1 : 0.8 })),
    ...demoGames.map((g) => ({ url: `${site.url}/games/${g.slug}` })),
    ...demoDevelopers.map((d) => ({ url: `${site.url}/developers/${d.slug}` })),
    ...demoTournaments.map((t) => ({ url: `${site.url}/tournaments/${t.slug}` })),
  ]
}
