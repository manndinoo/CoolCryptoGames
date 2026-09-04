'use client'

import { useCallback, useEffect, useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import bs58 from 'bs58'
import { collectFingerprint } from '@/lib/client/fingerprint'

export type AuthState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'signing-in' }
  | { status: 'signed-in'; wallet: string }
  | { status: 'blocked'; reason: string }

/**
 * Connecting a wallet proves nothing on its own — the browser just knows an
 * address. Signing the server's challenge is what proves control of the key,
 * so the session is only issued after that round trip.
 */
export function useWalletAuth() {
  const { publicKey, signMessage, disconnect } = useWallet()
  const [state, setState] = useState<AuthState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((data: { wallet: string | null }) => {
        if (cancelled) return
        setState(data.wallet ? { status: 'signed-in', wallet: data.wallet } : { status: 'signed-out' })
      })
      .catch(() => !cancelled && setState({ status: 'signed-out' }))
    return () => {
      cancelled = true
    }
  }, [])

  const signIn = useCallback(async () => {
    if (!publicKey || !signMessage) return
    setState({ status: 'signing-in' })

    const fingerprint = collectFingerprint()
    const address = publicKey.toBase58()

    try {
      const challengeRes = await fetch('/api/auth/challenge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address, fingerprint }),
      })
      const challenge = await challengeRes.json()
      if (!challengeRes.ok) {
        setState({ status: 'blocked', reason: challenge.reason ?? challenge.error })
        return
      }

      const signature = await signMessage(new TextEncoder().encode(challenge.message))

      const verifyRes = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          nonce: challenge.nonce,
          signature: bs58.encode(signature),
          fingerprint,
        }),
      })
      const verified = await verifyRes.json()
      if (!verifyRes.ok) {
        setState({ status: 'blocked', reason: verified.reason ?? verified.error })
        return
      }

      setState({ status: 'signed-in', wallet: verified.wallet })
    } catch {
      // Covers the common case of the player dismissing the wallet's signing
      // prompt, which is not an error worth surfacing as one.
      setState({ status: 'signed-out' })
    }
  }, [publicKey, signMessage])

  const signOut = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    await disconnect().catch(() => {})
    setState({ status: 'signed-out' })
  }, [disconnect])

  return { state, signIn, signOut, connected: Boolean(publicKey) }
}
