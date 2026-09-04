"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

/**
 * "Connect a wallet", without loading a wallet until someone means it.
 *
 * Account pages used to be wrapped in the provider outright. That put roughly
 * 150KB of adapter in front of the page and swapped a placeholder for the real
 * content once it arrived — measured at CLS 0.647 and LCP 3.5s on a throttled
 * phone, against thresholds of 0.1 and 2.5s. The page renders from the session
 * cookie now, which needs no wallet code at all, and this button fetches the
 * stack only when pressed.
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

function preload(): void {
  void import("./connect-flow");
}

export function ConnectPanel({ onSignedIn }: { onSignedIn: () => void }) {
  const [started, setStarted] = useState(false);

  if (started) return <ConnectFlow onSignedIn={onSignedIn} />;

  return (
    <button
      onClick={() => setStarted(true)}
      onPointerEnter={preload}
      onFocus={preload}
      onTouchStart={preload}
      className="ccg-btn ccg-btn-primary[1.02] active:scale-[0.99]"
    >
      Connect a wallet
    </button>
  );
}
