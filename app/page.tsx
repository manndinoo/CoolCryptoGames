import Link from 'next/link'
import { games } from '@/lib/games'
import { site } from '@/site.config'

export default function Home() {
  return (
    <>
      <section className="pb-16">
        <h1 className="max-w-2xl text-5xl font-semibold tracking-tight text-balance">
          {site.tagline}
        </h1>
        <p className="mt-5 max-w-xl text-lg text-white/60">
          {site.description}
        </p>
        <Link
          href="/#games"
          className="mt-8 inline-block rounded-lg bg-[var(--color-accent)] px-5 py-2.5 font-medium transition hover:opacity-90"
        >
          Browse games
        </Link>
      </section>

      <section id="games" className="scroll-mt-24">
        <h2 className="text-sm font-medium tracking-widest text-white/40 uppercase">
          Games
        </h2>
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">
          {games.map((game) => (
            <li key={game.slug}>
              <Link
                href={`/games/${game.slug}`}
                className="block h-full rounded-xl border border-white/10 bg-[var(--color-surface)] p-6 transition hover:border-white/25"
              >
                <div className="flex items-start justify-between gap-4">
                  <h3 className="font-semibold">{game.title}</h3>
                  {game.status === 'coming-soon' && (
                    <span className="shrink-0 rounded-full border border-white/15 px-2 py-0.5 text-xs text-white/50">
                      Coming soon
                    </span>
                  )}
                </div>
                <p className="mt-2 text-sm text-white/60">{game.blurb}</p>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}
