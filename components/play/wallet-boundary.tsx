"use client";

import dynamic from "next/dynamic";

/**
 * Loads the Solana wallet stack, and only then.
 *
 * The adapter, its modal and web3.js come to roughly 300KB of JavaScript. That
 * used to be in the root layout, so every visitor downloaded and parsed all of
 * it to read a leaderboard — on a mid-range phone that is time spent before
 * anything on screen responds, and it was spent on behalf of the small
 * fraction of visitors who go on to connect anything.
 *
 * Now it is fetched at the moment someone asks to play or opens their account.
 * `preloadWallet` starts that fetch on hover or first touch, so by the time the
 * click lands the chunk is usually already there.
 */
const WalletProviders = dynamic(
  () => import("@/app/providers").then((m) => m.Providers),
  {
    // The adapter reads `window` on mount, so there is nothing to render on the
    // server and attempting it produces a hydration mismatch.
    ssr: false,
    loading: () => (
      <div className="grid min-h-40 place-items-center">
        <p className="text-sm text-[var(--color-muted)]">Preparing wallet…</p>
      </div>
    ),
  },
);

export function WalletBoundary({ children }: { children: React.ReactNode }) {
  return <WalletProviders>{children}</WalletProviders>;
}

/** Warms the chunk ahead of the click. Safe to call repeatedly. */
export function preloadWallet(): void {
  void import("@/app/providers");
}
