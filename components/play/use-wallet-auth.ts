"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import bs58 from "bs58";
import { collectFingerprint } from "@/lib/client/fingerprint";

export type AuthState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "signing-in" }
  | { status: "needs-username"; wallet: string }
  | { status: "signed-in"; wallet: string; username: string }
  | { status: "blocked"; reason: string }
  /** Something failed that is not the player's doing. Distinct from blocked. */
  | { status: "failed"; message: string };

/**
 * Connecting a wallet proves nothing on its own — the browser just knows an
 * address. Signing the server's challenge is what proves control of the key,
 * so the session is only issued after that round trip.
 */
export function useWalletAuth() {
  const { publicKey, signMessage, disconnect } = useWallet();
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data: { wallet: string | null; username: string | null }) => {
        if (cancelled) return;
        setState(resolveSignedIn(data));
      })
      .catch(() => !cancelled && setState({ status: "signed-out" }));
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async () => {
    if (!publicKey || !signMessage) return;
    setState({ status: "signing-in" });

    const fingerprint = collectFingerprint();
    const address = publicKey.toBase58();

    try {
      const challengeRes = await fetch("/api/auth/challenge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address, fingerprint }),
      });
      const challenge = await readJson(challengeRes);
      if (!challengeRes.ok) {
        setState(failureFor(challengeRes.status, challenge));
        return;
      }

      if (
        typeof challenge.message !== "string" ||
        typeof challenge.nonce !== "string"
      ) {
        // A 200 that is missing what the flow needs is a server fault, not a
        // player one.
        setState(failureFor(500, challenge));
        return;
      }

      const signature = await signMessage(
        new TextEncoder().encode(challenge.message),
      );

      const verifyRes = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nonce: challenge.nonce,
          signature: bs58.encode(signature),
          fingerprint,
        }),
      });
      const verified = await readJson(verifyRes);
      if (!verifyRes.ok) {
        setState(failureFor(verifyRes.status, verified));
        return;
      }

      setState(
        resolveSignedIn({
          wallet: typeof verified.wallet === "string" ? verified.wallet : null,
          username:
            typeof verified.username === "string" ? verified.username : null,
        }),
      );
    } catch (err) {
      // Dismissing the wallet's own prompt is a decision, not a fault, and
      // should leave no error on screen. Everything else — the server being
      // down, a request failing, a response that is not JSON — has to be said
      // out loud. Treating them all as a cancellation is what made a broken
      // sign-in look like a button that does nothing.
      setState(
        isUserRejection(err)
          ? { status: "signed-out" }
          : {
              status: "failed",
              message:
                "Sign-in could not be completed. Please try again in a moment.",
            },
      );
    }
  }, [publicKey, signMessage]);

  const signOut = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    await disconnect().catch(() => {});
    setState({ status: "signed-out" });
  }, [disconnect]);

  /** Called once a name has been claimed, so the UI advances without a reload. */
  const setUsername = useCallback((username: string) => {
    setState((prev) =>
      prev.status === "needs-username" || prev.status === "signed-in"
        ? { status: "signed-in", wallet: prev.wallet, username }
        : prev,
    );
  }, []);

  return { state, signIn, signOut, setUsername, connected: Boolean(publicKey) };
}

/** Parses a response body without throwing when it is not JSON (a proxy error
 *  page, an empty 500). A parse failure must not masquerade as a cancellation. */
async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Turns a failed response into a state.
 *
 * 403 means a decision was made about this account and the player should see
 * the reason. Anything else is our problem, not theirs, and says so rather
 * than showing a bare reason code.
 */
function failureFor(status: number, body: Record<string, unknown>): AuthState {
  if (status === 403 && typeof body.reason === "string") {
    return { status: "blocked", reason: body.reason };
  }
  if (status === 503) {
    return {
      status: "failed",
      message: "Sign-in is temporarily unavailable. Please try again shortly.",
    };
  }
  if (status === 401) {
    return {
      status: "failed",
      message:
        "That signature could not be verified. Please try signing in again.",
    };
  }
  return {
    status: "failed",
    message: "Sign-in could not be completed. Please try again in a moment.",
  };
}

/** Wallet adapters surface a dismissed prompt in several shapes. */
function isUserRejection(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const name = (err as { name?: unknown }).name;
  const message = String(
    (err as { message?: unknown }).message ?? "",
  ).toLowerCase();
  return (
    name === "WalletSignMessageError" ||
    message.includes("user rejected") ||
    message.includes("user denied") ||
    message.includes("rejected the request")
  );
}

/**
 * An authenticated wallet with no name yet is a distinct state, not a signed-out
 * one. Collapsing the two would either lock a new player out or leave public
 * surfaces with nothing to render but an address.
 */
function resolveSignedIn(data: {
  wallet: string | null;
  username?: string | null;
}): AuthState {
  if (!data.wallet) return { status: "signed-out" };
  return data.username
    ? { status: "signed-in", wallet: data.wallet, username: data.username }
    : { status: "needs-username", wallet: data.wallet };
}
