"use client";

import { useEffect } from "react";
import { Providers } from "@/app/providers";
import { UsernameSetup } from "./username-setup";
import { WalletSheet } from "./wallet-sheet";
import { useWalletAuth } from "./use-wallet-auth";

/**
 * Connect a wallet and, if it is new, name it. Loaded on demand.
 *
 * Bundled with the providers so that asking to connect is one fetch rather
 * than two in sequence.
 */
function Flow({ onSignedIn }: { onSignedIn: () => void }) {
  const { state, signIn, setUsername, connected } = useWalletAuth();
  const done = state.status === "signed-in";

  // In an effect, not in render: telling the parent to re-read its session is
  // a side effect, and doing it during render is how you get an update-during-
  // render warning and a lost state change.
  useEffect(() => {
    if (done) onSignedIn();
  }, [done, onSignedIn]);

  if (state.status === "needs-username") {
    return <UsernameSetup onDone={setUsername} />;
  }
  if (done) return null;

  return <WalletSheet state={state} onSignIn={signIn} connected={connected} />;
}

export function ConnectFlow({ onSignedIn }: { onSignedIn: () => void }) {
  return (
    <Providers>
      <Flow onSignedIn={onSignedIn} />
    </Providers>
  );
}
