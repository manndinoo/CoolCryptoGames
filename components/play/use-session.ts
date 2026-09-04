"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Who the server thinks you are, with no wallet library involved.
 *
 * Split out from `useWalletAuth` because the two answer different questions and
 * cost wildly different amounts. "Am I signed in?" is one fetch against a
 * cookie. "Connect a wallet and sign a challenge" needs the whole Solana
 * adapter stack, which is around 300KB of JavaScript.
 *
 * Anything that only reads identity — chat, a signed-in profile panel — uses
 * this and downloads none of that. The stack is loaded when a player actually
 * asks to connect, which is the only moment it is any use.
 */

export type SessionState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "needs-username"; wallet: string }
  | { status: "signed-in"; wallet: string; username: string };

export function readSessionResponse(data: {
  wallet: string | null;
  username?: string | null;
}): SessionState {
  if (!data.wallet) return { status: "signed-out" };
  return data.username
    ? { status: "signed-in", wallet: data.wallet, username: data.username }
    : { status: "needs-username", wallet: data.wallet };
}

export function useSession() {
  const [state, setState] = useState<SessionState>({ status: "loading" });

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me");
      const data = (await res.json()) as {
        wallet: string | null;
        username: string | null;
      };
      setState(readSessionResponse(data));
    } catch {
      // No session is the safe reading of a failed check. Claiming a session
      // we could not confirm would show account UI to a stranger.
      setState({ status: "signed-out" });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await refresh();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  return { state, setState, refresh };
}
