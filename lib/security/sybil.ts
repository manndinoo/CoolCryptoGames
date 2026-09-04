import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'

/**
 * Cost-to-create gate.
 *
 * Wallet gating on its own stops nobody: generating a Solana keypair is free,
 * instant, and scriptable, so "must connect a wallet" is a bot's cheapest
 * possible obstacle. It only becomes a real barrier once holding an eligible
 * wallet costs something the attacker has to spend per identity.
 *
 * The two checks here are the cheap ones. Both are configurable and both are
 * off by default, because turning them on excludes real new players — that is
 * a product decision about how much friction a new signup is worth, not
 * something to switch on silently.
 *
 * A stronger version, when you need it, is a refundable deposit: stake a small
 * amount to play ranked, forfeit it on a confirmed cheat. That prices abuse
 * directly instead of proxying it through wallet wealth.
 */

export type SybilResult = { ok: true } | { ok: false; reason: string }

function rpcUrl(): string {
  return process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com'
}

export async function passesSybilGate(address: string): Promise<SybilResult> {
  const minSol = Number(process.env.MIN_WALLET_SOL ?? '0')
  const minAgeDays = Number(process.env.MIN_WALLET_AGE_DAYS ?? '0')

  if (!(minSol > 0) && !(minAgeDays > 0)) return { ok: true }

  const connection = new Connection(rpcUrl(), 'confirmed')
  const pubkey = new PublicKey(address)

  if (minSol > 0) {
    const lamports = await connection.getBalance(pubkey)
    if (lamports < minSol * LAMPORTS_PER_SOL) {
      return { ok: false, reason: 'insufficient_balance' }
    }
  }

  if (minAgeDays > 0) {
    // Oldest signature we can see for the account. A wallet minted minutes ago
    // to farm a leaderboard has none.
    const sigs = await connection.getSignaturesForAddress(pubkey, { limit: 1000 })
    const oldest = sigs.at(-1)
    if (!oldest?.blockTime) return { ok: false, reason: 'no_transaction_history' }

    const ageDays = (Date.now() / 1000 - oldest.blockTime) / 86_400
    if (ageDays < minAgeDays) return { ok: false, reason: 'wallet_too_new' }
  }

  return { ok: true }
}
