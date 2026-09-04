'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useState } from 'react'
import { formatSol, formatUsd } from '@/lib/store/pricing'
import type { StoreItemView } from './purchase-flow'

const PurchaseFlow = dynamic(
  () => import('./purchase-flow').then((m) => m.PurchaseFlow),
  { ssr: false, loading: () => <p className="mt-3 text-sm text-[var(--color-muted)]">Preparing wallet…</p> },
)

type Catalogue = {
  enabled: boolean
  cluster: string | null
  treasury: string | null
  solUsdRate: number | null
  items: StoreItemView[]
}

/**
 * A game's store.
 *
 * Everything sold here is cosmetic or extra content. Nothing on this panel
 * changes what a player can achieve — no lives, no attempts, no boosts, no
 * ranked entries — and the item catalogue has no kind that could carry one.
 * A wallet that never spends anything plays every game in full.
 *
 * The disclosure below the list is not decoration. The exact amount, the exact
 * recipient and the cluster are on screen before any wallet is asked to sign,
 * because a transfer a player did not see coming is the thing the founding
 * product forbids outright.
 *
 * Renders nothing at all when the game sells nothing or purchases are off,
 * which is the default state of both.
 */
export function StorePanel({ gameSlug, title }: { gameSlug: string; title: string }) {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null)
  const [buying, setBuying] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/store/entitlements?game=${encodeURIComponent(gameSlug)}`)
      if (res.ok) setCatalogue((await res.json()) as Catalogue)
    } catch {
      // Leaves the panel hidden rather than showing a store that cannot sell.
    }
  }, [gameSlug])

  useEffect(() => {
    void load()
  }, [load])

  const onOwned = useCallback(() => {
    setBuying(null)
    void load()
  }, [load])

  if (!catalogue?.enabled || catalogue.items.length === 0) return null

  return (
    <section className="ccg-surface mt-[var(--spacing-6)] p-[var(--spacing-5)]">
      <h2 className="text-[11px] font-bold tracking-[var(--tracking-label)] text-[var(--color-muted)] uppercase">
        {title} store
      </h2>
      <p className="mt-3 max-w-xl text-sm text-[var(--color-muted)]">
        Appearance and extra content only. Nothing here changes what you can
        achieve, and the game is complete without buying anything.
      </p>

      <ul className="mt-[var(--spacing-5)] grid gap-px bg-[var(--color-line)]">
        {catalogue.items.map((item) => (
          <li key={item.id} className="bg-[var(--color-graphite)] p-[var(--spacing-4)]">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-56 flex-1">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-display font-extrabold uppercase">{item.name}</span>
                  <span className="text-[10px] font-bold tracking-[var(--tracking-label)] text-[var(--color-muted)] uppercase">
                    {item.kind}
                  </span>
                </p>
                <p className="mt-1 text-sm text-[var(--color-muted)]">{item.description}</p>
                {item.estimatedLamports !== null && (
                  <p className="mt-1.5 text-xs text-[var(--color-muted)]">
                    {formatUsd(item.usdCents)} · about {formatSol(item.estimatedLamports)} at
                    today&apos;s rate
                  </p>
                )}
              </div>

              {item.owned ? (
                <span className="shrink-0 text-[11px] font-bold tracking-[var(--tracking-label)] text-[var(--color-success)] uppercase">
                  ✓ Owned
                </span>
              ) : (
                <button
                  onClick={() => setBuying(item.id)}
                  disabled={buying !== null}
                  className="ccg-btn ccg-btn-ghost shrink-0 disabled:opacity-50"
                >
                  Buy · {formatUsd(item.usdCents)}
                </button>
              )}
            </div>

            {buying === item.id && (
              <PurchaseFlow gameSlug={gameSlug} item={item} onOwned={onOwned} />
            )}
          </li>
        ))}
      </ul>

      <dl className="mt-[var(--spacing-5)] grid gap-2 border-t border-[var(--color-line)] pt-[var(--spacing-4)] text-xs text-[var(--color-muted)]">
        <Row label="You pay">
          In SOL, once, from your own wallet, plus the network fee. Prices are
          set in dollars and converted when you press Buy; the exact SOL amount
          is fixed at that moment and shown by your wallet before you approve
          it. CCG holds no balance for you and cannot charge you again.
        </Row>
        <Row label="Goes to">
          <span className="font-mono break-all">{catalogue.treasury}</span> on {catalogue.cluster}
        </Row>
        <Row label="You get">
          The item, attached to this wallet for this game. It does not carry to
          another game and it is not transferable.
        </Row>
        <Row label="Refunds">
          An on-chain payment cannot be reversed by us. Buy only what you meant to.
        </Row>
      </dl>
    </section>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-3">
      <dt className="w-20 shrink-0 font-bold tracking-[var(--tracking-label)] uppercase">
        {label}
      </dt>
      <dd className="min-w-56 flex-1">{children}</dd>
    </div>
  )
}
