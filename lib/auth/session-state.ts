/**
 * The shape of "who is signed in", shared by the server and the browser.
 *
 * Deliberately not in `components/play/use-session.ts`. That module is marked
 * `'use client'`, and a function exported from a client module is a client
 * reference — importing it into a server component and calling it fails at
 * request time with "Attempted to call it from the server". A pure module that
 * neither side owns is the only place this can live.
 */

export type SessionState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'needs-username'; wallet: string }
  | { status: 'signed-in'; wallet: string; username: string }

/**
 * An authenticated wallet with no name yet is a distinct state, not a
 * signed-out one. Collapsing the two would either lock a new player out or
 * leave a public surface with nothing to render but an address.
 */
export function readSessionResponse(data: {
  wallet: string | null
  username?: string | null
}): SessionState {
  if (!data.wallet) return { status: 'signed-out' }
  return data.username
    ? { status: 'signed-in', wallet: data.wallet, username: data.username }
    : { status: 'needs-username', wallet: data.wallet }
}
