import type { Metadata } from 'next'
import Link from 'next/link'
import { StatusPill } from '@/components/ui/badges'
import { BroadcasterSetup } from '@/components/live/broadcaster-setup'
import { features } from '@/lib/flags'

export const metadata: Metadata = {
  title: 'Broadcaster setup',
  description: 'Set up a CCG channel.',
  robots: { index: false },
}

export default function GoLivePage() {
  return (
    <div className="pt-[var(--spacing-7)]">
      <Link href="/live" className="text-sm text-[var(--color-muted)] hover:text-bone">
        ← Live
      </Link>

      <h1 className="mt-[var(--spacing-5)] font-display text-4xl font-bold tracking-[var(--tracking-display)] uppercase">
        Broadcaster setup
      </h1>
      <p className="mt-3 max-w-xl text-[var(--color-muted)]">
        Two ways to stream a CCG game with your camera on. One works today.
      </p>

      <div className="mt-[var(--spacing-6)] grid gap-[var(--spacing-4)] lg:grid-cols-2 lg:items-stretch">
        {/* -------------------------------------------- the path that works */}
        <section className="ccg-surface rounded-[var(--radius-large)] p-[var(--spacing-5)]">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="font-display text-sm font-bold tracking-[var(--tracking-label)] uppercase">
              Stream through your own provider
            </h2>
            <StatusPill>Available now</StatusPill>
          </div>

          <p className="text-sm text-[var(--color-muted)]">
            The same setup you would use on any streaming platform. Your encoder captures
            the game and your camera, composites them, and sends one video to your
            provider. CCG frames that stream on your channel page.
          </p>

          <ol className="mt-[var(--spacing-5)] grid gap-3 text-sm text-[var(--color-muted)]">
            {[
              'Get your channel approved. Broadcasting on CCG is pre-approved, not open.',
              'Capture the CCG game window and your camera in your encoder, arranged how you like.',
              'Stream to your provider as normal.',
              'Give CCG your channel URL. It is checked against the approved-host allow-list before it can be framed.',
            ].map((step, i) => (
              <li key={step} className="flex gap-3">
                <span className="font-display font-bold text-cobalt">{i + 1}</span>
                {step}
              </li>
            ))}
          </ol>

          <p className="mt-[var(--spacing-5)] text-xs text-[var(--color-muted)]">
            Because your encoder does the compositing, camera-over-game needs nothing
            special from CCG. This is how the founding phase of the streaming rollout
            works: official channel plus approved embedded creators.
          </p>
        </section>

        {/* ------------------------------------------------ the path that does not */}
        <section className="ccg-surface rounded-[var(--radius-large)] p-[var(--spacing-5)]">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="font-display text-sm font-bold tracking-[var(--tracking-label)] uppercase">
              Broadcast through CCG
            </h2>
            <StatusPill tone={features.nativeStreaming ? 'neutral' : 'alert'}>
              {features.nativeStreaming ? 'Enabled' : 'Not enabled'}
            </StatusPill>
          </div>

          <p className="text-sm text-[var(--color-muted)]">
            CCG captures the game and your camera in the browser and distributes them
            itself, so you can go live without an encoder.
          </p>

          {!features.nativeStreaming && (
            <p className="mt-[var(--spacing-4)] rounded-[var(--radius-medium)] border border-[var(--color-subtle-border)] bg-carbon p-4 text-xs text-[var(--color-muted)]">
              This is switched off. Distributing video needs a streaming provider under
              contract and a moderation operation able to watch live content, and neither
              exists yet. The composition tool below still works — the camera preview is
              local to your machine, and nothing it shows is uploaded, recorded, or sent
              anywhere.
            </p>
          )}

          <p className="mt-[var(--spacing-4)] text-xs text-[var(--color-muted)]">
            When it is enabled, the arrangement you set below is what viewers see. The
            preview runs the same layout code the channel page does, so it shows the real
            result rather than an illustration of one.
          </p>
        </section>
      </div>

      {/* Full width: the composition tool is far taller than either card above,
          and pairing it with one would leave half the page empty. */}
      <section className="ccg-surface mt-[var(--spacing-4)] rounded-[var(--radius-large)] p-[var(--spacing-5)]">
        <h2 className="mb-[var(--spacing-5)] font-display text-sm font-bold tracking-[var(--tracking-label)] uppercase">
          Composition
        </h2>
        <BroadcasterSetup />
      </section>

      <section className="mt-[var(--spacing-7)] max-w-2xl">
        <h2 className="font-display text-sm font-bold tracking-[var(--tracking-label)] uppercase">
          Camera and safety
        </h2>
        <ul className="mt-3 grid gap-2 text-sm text-[var(--color-muted)]">
          <li>The camera never starts on its own. Only a deliberate press opens it.</li>
          <li>
            A game runs in a sandboxed frame and is never granted camera or microphone
            permission. Untrusted game code cannot reach your camera through the page it
            shares with it.
          </li>
          <li>
            Turning the camera off stops the device tracks, so your hardware light goes
            out rather than staying lit on a paused preview.
          </li>
          <li>Broadcasting is 18+, named, and pre-approved. Anonymous streaming is not offered.</li>
        </ul>
      </section>
    </div>
  )
}
