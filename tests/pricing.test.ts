import { afterEach, describe, expect, it } from 'vitest'
import {
  LAMPORTS_PER_SOL,
  MAX_QUOTE_LAMPORTS,
  MAX_SOL_USD,
  MIN_SOL_USD,
  formatSol,
  formatUsd,
  lamportsForUsd,
  priceFeedUrls,
  readRate,
  solUsdRate,
  __setCachedRate,
} from '@/lib/store/pricing'

afterEach(() => __setCachedRate(null))

describe('lamportsForUsd', () => {
  it('converts a dollar price at the given rate', () => {
    // $0.99 at $200/SOL is 0.00495 SOL.
    expect(lamportsForUsd(99, 200)).toEqual({ ok: true, lamports: 4_950_000 })
  })

  it('rounds up to the nearest lamport', () => {
    // Rounding down could land a lamport short of the price, which the
    // settlement check would then reject as underpaid.
    const r = lamportsForUsd(99, 137) as { ok: true; lamports: number }
    expect(r.lamports).toBe(Math.ceil((0.99 / 137) * LAMPORTS_PER_SOL))
    expect(r.lamports / LAMPORTS_PER_SOL).toBeGreaterThanOrEqual(0.99 / 137)
  })

  it('charges less SOL when SOL is worth more', () => {
    const cheap = lamportsForUsd(99, 100) as { lamports: number }
    const dear = lamportsForUsd(99, 400) as { lamports: number }
    expect(dear.lamports).toBeLessThan(cheap.lamports)
  })

  it('refuses a rate outside the believable range', () => {
    // Not an opinion about the market — a guard against a feed returning zero,
    // a string, or a number in the wrong units.
    expect(lamportsForUsd(99, 0)).toEqual({ ok: false, reason: 'rate_unusable' })
    expect(lamportsForUsd(99, MIN_SOL_USD - 0.01)).toEqual({ ok: false, reason: 'rate_unusable' })
    expect(lamportsForUsd(99, MAX_SOL_USD + 1)).toEqual({ ok: false, reason: 'rate_unusable' })
    expect(lamportsForUsd(99, Number.NaN)).toEqual({ ok: false, reason: 'rate_unusable' })
    expect(lamportsForUsd(99, Number.POSITIVE_INFINITY)).toEqual({ ok: false, reason: 'rate_unusable' })
  })

  it('refuses an amount that is not a positive whole number of cents', () => {
    expect(lamportsForUsd(0, 200)).toEqual({ ok: false, reason: 'amount_invalid' })
    expect(lamportsForUsd(-99, 200)).toEqual({ ok: false, reason: 'amount_invalid' })
    expect(lamportsForUsd(99.5, 200)).toEqual({ ok: false, reason: 'amount_invalid' })
  })

  it('refuses a quote larger than the hard cap, whatever the arithmetic says', () => {
    // A cheap SOL and an expensive item must not combine into a quote nobody
    // meant to make. The cap is inclusive: landing exactly on it is fine,
    // going past it is not.
    expect(MAX_QUOTE_LAMPORTS).toBe(5 * LAMPORTS_PER_SOL)
    expect(lamportsForUsd(500, MIN_SOL_USD)).toEqual({ ok: true, lamports: MAX_QUOTE_LAMPORTS })
    expect(lamportsForUsd(501, MIN_SOL_USD)).toEqual({ ok: false, reason: 'quote_too_large' })
  })
})

describe('formatting', () => {
  it('writes dollars the way a price is written', () => {
    expect(formatUsd(99)).toBe('$0.99')
    expect(formatUsd(199)).toBe('$1.99')
    expect(formatUsd(100)).toBe('$1')
  })

  it('never shows a SOL figure below what is charged', () => {
    expect(formatSol(1)).toBe('0.0001 SOL')
    expect(formatSol(0.00499 * LAMPORTS_PER_SOL)).toBe('0.005 SOL')
  })
})

describe('the price feed list', () => {
  it('carries several providers, so one going down is not an outage', () => {
    // A single feed's failure mode is "no sales".
    expect(priceFeedUrls().length).toBeGreaterThan(1)
    expect(new Set(priceFeedUrls().map((u) => new URL(u).host)).size).toBe(priceFeedUrls().length)
  })

  it('lets a deployment replace the whole list with a paid provider', () => {
    const previous = process.env.SOL_PRICE_URL
    process.env.SOL_PRICE_URL = 'https://example.test/price'
    expect(priceFeedUrls()).toEqual(['https://example.test/price'])
    if (previous === undefined) delete process.env.SOL_PRICE_URL
    else process.env.SOL_PRICE_URL = previous
  })
})

describe('readRate', () => {
  it('reads every shape the configured feeds return', () => {
    expect(readRate({ solana: { usd: 213.44 } })).toBe(213.44)          // CoinGecko
    expect(readRate({ data: { amount: '213.44' } })).toBe(213.44)        // Coinbase
    expect(readRate({ price: '213.44' })).toBe(213.44)                   // Binance
    expect(readRate({ result: { SOLUSD: { c: ['213.44', '1'] } } })).toBe(213.44) // Kraken
  })

  it('refuses a shape it does not recognise rather than guessing', () => {
    // This number gets multiplied by a real payment. A guess here is the one
    // mistake that could overcharge somebody by orders of magnitude.
    expect(readRate({ unexpected: 213 })).toBeNull()
    expect(readRate('213')).toBeNull()
    expect(readRate(null)).toBeNull()
  })

  it('refuses a value outside the believable range', () => {
    expect(readRate({ price: 0 })).toBeNull()
    expect(readRate({ price: 99_999 })).toBeNull()
  })
})

describe('solUsdRate', () => {
  it('serves a fresh cached rate without asking the feed', async () => {
    __setCachedRate({ solUsd: 200, at: Date.now() })
    expect(await solUsdRate()).toBe(200)
  })

  it('falls back to a recently cached rate when the feed is unreachable', async () => {
    // A stale rate for a few minutes beats refusing every sale.
    __setCachedRate({ solUsd: 200, at: Date.now() - 5 * 60_000 })
    expect(await solUsdRate()).toBe(200)
  })

  it('returns null rather than quoting from an hour-old rate', async () => {
    __setCachedRate({ solUsd: 200, at: Date.now() - 60 * 60_000 })
    expect(await solUsdRate()).toBeNull()
  })
})
