/**
 * Turning a dollar price into a SOL amount.
 *
 * Items are priced in USD because that is what a price means to a person, and
 * charged in SOL because that is what the wallet sends. The conversion happens
 * once, when a purchase is quoted, and the resulting lamport figure is stored
 * on the intent — so the number the player approves is the number the server
 * later checks against the chain, and a move in the SOL price between quote and
 * signature cannot change what they owe.
 *
 * That is also why the quote expires. A price held open indefinitely is a price
 * somebody comes back to claim after the market has moved.
 */

export const LAMPORTS_PER_SOL = 1_000_000_000

/**
 * Bounds on a believable SOL price, in USD.
 *
 * Not an opinion about the market — a guard against a feed returning zero, a
 * string, or a number in the wrong units. Outside this range the conversion
 * refuses rather than quoting, because the failure it prevents is charging
 * someone a thousand times the intended price.
 */
export const MIN_SOL_USD = 1
export const MAX_SOL_USD = 10_000

/** Nothing may be quoted above this, whatever the arithmetic says. */
export const MAX_QUOTE_LAMPORTS = 5 * LAMPORTS_PER_SOL

export type PriceResult =
  | { ok: true; lamports: number }
  | { ok: false; reason: 'rate_unusable' | 'amount_invalid' | 'quote_too_large' }

/**
 * @param usdCents The item's price, in whole cents.
 * @param solUsd What one SOL is worth in USD.
 *
 * Rounds up to the nearest lamport. A lamport is a billionth of a SOL, so
 * rounding up costs the buyer nothing measurable and guarantees the transfer
 * clears the price rather than landing a lamport short of it — which the
 * settlement check would reject as underpaid.
 */
export function lamportsForUsd(usdCents: number, solUsd: number): PriceResult {
  if (!Number.isFinite(solUsd) || solUsd < MIN_SOL_USD || solUsd > MAX_SOL_USD) {
    return { ok: false, reason: 'rate_unusable' }
  }
  if (!Number.isInteger(usdCents) || usdCents <= 0) {
    return { ok: false, reason: 'amount_invalid' }
  }

  const lamports = Math.ceil((usdCents / 100 / solUsd) * LAMPORTS_PER_SOL)
  if (lamports <= 0) return { ok: false, reason: 'amount_invalid' }
  if (lamports > MAX_QUOTE_LAMPORTS) return { ok: false, reason: 'quote_too_large' }

  return { ok: true, lamports }
}

/** `$1.99`. Whole dollars drop the cents. */
export function formatUsd(usdCents: number): string {
  const dollars = usdCents / 100
  return usdCents % 100 === 0 ? `$${dollars}` : `$${dollars.toFixed(2)}`
}

/**
 * `0.0043 SOL`. Four decimals, which is about a hundredth of a cent at any
 * plausible SOL price, and never rounded down — a displayed figure below what
 * is actually charged is the one that reads as a bait.
 */
export function formatSol(lamports: number): string {
  const sol = lamports / LAMPORTS_PER_SOL
  const shown = Math.ceil(sol * 10_000) / 10_000
  return `${shown.toFixed(4).replace(/\.?0+$/, '')} SOL`
}

// ---------------------------------------------------------------- the feed

type Cached = { solUsd: number; at: number }
let cached: Cached | null = null

/** Refetch after this. */
const FRESH_MS = 60_000
/**
 * How stale a cached rate may get before quoting stops.
 *
 * A stale rate is better than no sale for a few minutes; an hour-old rate on a
 * volatile asset is not. Past this the intent route refuses to quote, which
 * costs a sale and cannot overcharge anyone.
 */
const MAX_STALE_MS = 10 * 60_000

export function priceFeedUrl(): string {
  return (
    process.env.SOL_PRICE_URL ??
    'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd'
  )
}

/**
 * Pulls a number out of whatever shape the configured feed returns.
 *
 * Handles the two common ones — CoinGecko's nested object and the flat
 * `{ price }` most exchange tickers use — and refuses anything else rather
 * than guessing at a number that will be multiplied by a real payment.
 */
export function readRate(body: unknown): number | null {
  if (typeof body !== 'object' || body === null) return null
  const b = body as Record<string, any>
  const candidates = [b?.solana?.usd, b?.price, b?.data?.amount, b?.USD, b?.usd]
  for (const c of candidates) {
    const n = typeof c === 'string' ? Number(c) : c
    if (typeof n === 'number' && Number.isFinite(n) && n >= MIN_SOL_USD && n <= MAX_SOL_USD) {
      return n
    }
  }
  return null
}

/**
 * The current SOL price, or null when there is no usable one.
 *
 * Null means do not quote. Guessing a rate is the one behaviour that could
 * charge a player many times what an item costs, so the failure is a refused
 * sale rather than an invented number.
 */
export async function solUsdRate(now = Date.now()): Promise<number | null> {
  if (cached && now - cached.at < FRESH_MS) return cached.solUsd

  try {
    const res = await fetch(priceFeedUrl(), {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(6_000),
    })
    if (res.ok) {
      const rate = readRate(await res.json())
      if (rate !== null) {
        cached = { solUsd: rate, at: now }
        return rate
      }
    }
  } catch {
    // Falls through to the cached value below.
  }

  if (cached && now - cached.at < MAX_STALE_MS) return cached.solUsd
  return null
}

/** Test seam. Not used by application code. */
export function __setCachedRate(value: Cached | null): void {
  cached = value
}
