"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { useSession } from "./use-session";

/**
 * Where a wallet is still worth having, on a game you can play without one.
 *
 * With the door open, the only remaining reason to sign in before playing is
 * the save: signed out, progress lives in this browser and stays there. So
 * that is the whole of what this says. It does not imply the game is limited,
 * because it is not, and it does not manufacture a reason to connect out of
 * one that does not exist.
 *
 * It is also the way in for testing the wallet path from the surface where it
 * matters. `/settings` can sign you in, but only here can you sign in, press
 * Play, and watch the save land against the wallet rather than the browser.
 */
const ConnectFlow = dynamic(
  () => import("./connect-flow").then((m) => m.ConnectFlow),
  {
    ssr: false,
    loading: () => (
      <p className="text-sm text-[var(--color-muted)]">Preparing wallet…</p>
    ),
  },
);

export function SignInPrompt() {
  const { state, refresh } = useSession();
  const [connecting, setConnecting] = useState(false);

  if (connecting) {
    return (
      <div className="mx-auto mt-[var(--spacing-4)] w-full max-w-3xl">
        <ConnectFlow
          onSignedIn={() => {
            setConnecting(false);
            void refresh();
          }}
        />
      </div>
    );
  }

  const signedIn = state.status === "signed-in";

  return (
    // Both states occupy the same row with a control of the same height, so
    // the session resolving swaps text rather than moving the page. The
    // catalogue entry, the store panel and the facts table all sit below this.
    <div className="mx-auto mt-[var(--spacing-4)] flex w-full max-w-3xl flex-wrap items-center justify-between gap-3">
      <p className="min-w-0 text-xs text-[var(--color-muted)]">
        {signedIn
          ? "Progress saves to your wallet — sign in anywhere to pick it up."
          : "Progress saves in this browser. Connect a wallet to carry it between devices."}
      </p>

      {signedIn ? (
        <span className="flex h-10 shrink-0 items-center gap-2 rounded-[var(--radius-pill)] border border-[var(--color-subtle-border)] px-3 text-[10px] font-bold tracking-[var(--tracking-label)] text-[var(--color-muted)] uppercase">
          <span aria-hidden className="size-1.5 rounded-full bg-accent" />
          {state.username}
        </span>
      ) : (
        <button
          onClick={() => setConnecting(true)}
          onPointerEnter={() => void import("./connect-flow")}
          onFocus={() => void import("./connect-flow")}
          onTouchStart={() => void import("./connect-flow")}
          className="ccg-btn ccg-btn-ghost h-10 shrink-0"
        >
          Connect a wallet
        </button>
      )}
    </div>
  );
}
