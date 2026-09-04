import type { MetadataRoute } from 'next'
import { games } from '@/lib/games'
import { site } from '@/site.config'

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: site.url, priority: 1 },
    ...games.map((game) => ({ url: `${site.url}/games/${game.slug}` })),
  ]
}
