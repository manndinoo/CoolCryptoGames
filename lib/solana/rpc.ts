import type { ChainTransaction } from '@/lib/store/verify'

/**
 * The one place this server talks to a Solana cluster.
 *
 * Kept to a single method on purpose. Verification needs exactly one fact —
 * what the chain says a given signature did — and everything else it needs
 * comes from the intent the server already issued. A wider client would be a
 * wider surface for no gain.
 */

/**
 * HTTPS, or loopback.
 *
 * A settlement decision rests on what this endpoint says, so a plaintext link
 * to it across a network is a link somebody else can answer. Loopback is
 * exempt because it never leaves the machine, and that is what makes a local
 * validator or a test double usable without weakening the rule anywhere it
 * matters.
 */
/**
 * Solana's own public endpoint. It works, and it is rate limited hard enough
 * that a real deployment should replace it with a provider — but a default
 * that works beats a deployment that silently cannot settle anything.
 */
const DEFAULT_RPC = 'https://api.mainnet-beta.solana.com'

export function rpcUrl(): string | null {
  const url = process.env.SOLANA_RPC_URL ?? process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? DEFAULT_RPC
  if (!url) return null
  if (url.startsWith('https://')) return url
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(url)) return url
  return null
}

/** Which cluster the treasury expects to be paid on. Shown to the player. */
export function cluster(): 'mainnet-beta' | 'devnet' | 'testnet' {
  const c = process.env.SOLANA_CLUSTER
  return c === 'devnet' || c === 'testnet' ? c : 'mainnet-beta'
}

export class RpcUnavailable extends Error {}

/**
 * Fetches one transaction.
 *
 * `null` means the cluster has no record of that signature, which is a
 * legitimate answer while a payment is still propagating — the caller reports
 * "not visible yet", not "rejected". An unreachable RPC is a different thing
 * and throws, so a settlement is never refused because the server could not
 * ask.
 */
export async function getTransaction(signature: string): Promise<ChainTransaction | null> {
  const url = rpcUrl()
  if (!url) throw new RpcUnavailable('SOLANA_RPC_URL is not configured')

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTransaction',
        params: [
          signature,
          // `json` keeps the account list flat and readable. The balance deltas
          // verification relies on live in `meta` either way.
          { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 0 },
        ],
      }),
      signal: AbortSignal.timeout(12_000),
    })
  } catch (err) {
    throw new RpcUnavailable(`RPC request failed: ${String(err)}`)
  }

  if (!res.ok) throw new RpcUnavailable(`RPC returned ${res.status}`)

  const body = (await res.json().catch(() => null)) as {
    result?: unknown
    error?: { message?: string }
  } | null

  if (!body) throw new RpcUnavailable('RPC returned a body that is not JSON')
  if (body.error) throw new RpcUnavailable(body.error.message ?? 'RPC error')
  if (body.result === null || body.result === undefined) return null

  return normalize(body.result)
}

/**
 * Narrows an RPC result to the shape verification reads.
 *
 * Returning a partial object rather than throwing on an unexpected shape would
 * hand the verifier something it could misread, so anything that does not carry
 * the fields is reported as absent and refused as malformed.
 */
function normalize(result: unknown): ChainTransaction | null {
  if (typeof result !== 'object' || result === null) return null
  const r = result as Record<string, any>
  const message = r.transaction?.message
  if (!message || !Array.isArray(message.accountKeys)) return null

  return {
    slot: Number(r.slot ?? 0),
    blockTime: typeof r.blockTime === 'number' ? r.blockTime : null,
    meta: r.meta
      ? {
          err: r.meta.err ?? null,
          fee: Number(r.meta.fee ?? 0),
          preBalances: (r.meta.preBalances ?? []).map(Number),
          postBalances: (r.meta.postBalances ?? []).map(Number),
        }
      : null,
    transaction: {
      message: {
        // Account keys arrive as strings in `json` encoding, or as objects
        // carrying `pubkey` when the request asked for parsed output.
        accountKeys: message.accountKeys.map((k: unknown) =>
          typeof k === 'string' ? k : String((k as { pubkey?: string })?.pubkey ?? ''),
        ),
      },
      signatures: Array.isArray(r.transaction?.signatures) ? r.transaction.signatures : [],
    },
  }
}
