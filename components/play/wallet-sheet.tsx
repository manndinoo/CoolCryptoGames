"use client";

import dynamic from "next/dynamic";
import type { AuthState } from "./use-wallet-auth";

// Reads wallet state that only exists in the browser, so server rendering it
// produces a hydration mismatch.
const WalletMultiButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false },
);

/**
 * The wallet explanation shown when someone presses Play without a verified
 * session.
 *
 * The disclosure sentence is required wording from the Security and Wallet
 * Protocol and must stay visible before any wallet interaction — the point of
 * the whole flow is that a player knows, before they click, that this is an
 * identity step and not a transaction.
 */
export function WalletSheet({
  state,
  onSignIn,
  connected,
}: {
  state: AuthState;
  onSignIn: () => void;
  connected: boolean;
}) {
  if (state.status === "failed") {
    return (
      <div className="ccg-surface rounded-[var(--radius-large)] p-[var(--spacing-6)]">
        <h3 className="font-display text-xl font-bold">
          Sign-in didn't complete
        </h3>
        <p className="mt-3 max-w-md text-sm text-[var(--color-muted)]">
          {state.message}
        </p>
        <button
          onClick={onSignIn}
          className="mt-[var(--spacing-5)] ccg-btn ccg-btn-primary"
        >
          Try again
        </button>
      </div>
    );
  }

  if (state.status === "blocked") {
    return (
      <div className="ccg-surface rounded-[var(--radius-large)] p-[var(--spacing-6)]">
        <h3 className="font-display text-xl font-bold">
          This account can't start a game
        </h3>
        <p className="mt-3 text-sm text-[var(--color-muted)]">
          Reference code <code className="text-bone">{state.reason}</code>. If
          you believe this is wrong, contact support and quote that code —
          competition decisions have an appeal path.
        </p>
      </div>
    );
  }

  return (
    <div className="ccg-surface rounded-[var(--radius-large)] p-[var(--spacing-6)]">
      <h3 className="font-display text-xl font-extrabold tracking-[var(--tracking-display)] uppercase">
        Connect a wallet to play
      </h3>

      <p className="mt-3 max-w-md text-sm text-[var(--color-muted)]">
        Browsing, watching and leaderboards are open to everyone. A wallet is
        your identity for competing, and nothing more.
      </p>

      {/* Required disclosure. Do not soften or hide this. */}
      <p className="mt-[var(--spacing-4)] max-w-md rounded-[var(--radius-medium)] border border-[var(--color-subtle-border)] bg-[var(--color-carbon)] p-4 text-sm">
        This signature will not create a transaction, cost gas, or give CCG
        access to your assets.
      </p>

      <ul className="mt-[var(--spacing-4)] grid gap-1.5 text-xs text-[var(--color-muted)]">
        <li>An empty wallet is fine — no balance, token or NFT is required.</li>
        <li>
          You are signing a message, not approving a transfer or an allowance.
        </li>
        <li>The game itself never receives your wallet or your session.</li>
      </ul>

      <div className="mt-[var(--spacing-5)] flex flex-wrap items-center gap-3">
        <WalletMultiButton />
        {connected && (
          <button
            onClick={onSignIn}
            disabled={state.status === "signing-in"}
            className="ccg-btn ccg-btn-primary disabled:opacity-50"
          >
            {state.status === "signing-in"
              ? "Check your wallet…"
              : "Sign in to play"}
          </button>
        )}
      </div>
    </div>
  );
}
