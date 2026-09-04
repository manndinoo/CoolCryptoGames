"use client";

import { useCallback, useEffect, useState } from "react";
import { readSessionResponse, type SessionState } from "@/lib/auth/session-state";

export { readSessionResponse };
export type { SessionState };

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

/**
 * @param initial Session read on the server, when the page can do that. Passing
 * it removes both the loading flash and the layout shift that came with it: the
 * account pages used to render a one-line "Loading…" and then swap in a full
 * page, which measured CLS 0.463 against a 0.1 threshold.
 */
export function useSession(initial?: SessionState) {
  const [state, setState] = useState<SessionState>(initial ?? { status: "loading" });

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

  // Only fetch when the server did not already answer. A page that was handed
  // its session has nothing to wait for.
  const needsFetch = initial === undefined;
  useEffect(() => {
    if (!needsFetch) return;
    void refresh();
  }, [needsFetch, refresh]);

  return { state, setState, refresh };
}
