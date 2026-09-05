/**
 * Whether a wallet is required before a game will start.
 *
 * It is not, currently. Anyone can open an unranked game and play it through
 * without connecting anything, and a wallet is never asked for at the door.
 *
 * The requirement it replaces was never a payment gate — the Bible is explicit
 * that an empty wallet has always been enough — it was an accountability gate,
 * there so that a result could be attached to somebody. That reasoning holds
 * exactly as far as there is a result worth attaching. An unranked game issues
 * no score, enters no competition and pays out nothing, so there is nothing for
 * the signature to be accountable for, and asking for one buys the platform a
 * wallet prompt in front of a free game and nothing else.
 *
 * What it still guards is untouched and is decided at the call site, not here:
 * ranked play, score submission, tournament entry, prize claims, chat and
 * purchases all continue to require a signed-in wallet, because each of those
 * produces something that has to belong to a person.
 *
 * `CCG_REQUIRE_WALLET_TO_PLAY=true` puts the gate back across every game.
 * It is read where pages render, and game pages are prerendered at build time,
 * so a change to it lands on the next deploy rather than immediately.
 */
const DEFAULT_REQUIRE_WALLET = false

export function walletRequiredToPlay(): boolean {
  const raw = process.env.CCG_REQUIRE_WALLET_TO_PLAY
  // Only the two spellings mean anything. Anything else — an empty string left
  // behind by a deleted variable, a "1", a stray quote — falls back to the
  // default rather than being guessed at, so a malformed value cannot quietly
  // decide this either way.
  if (raw === 'true') return true
  if (raw === 'false') return false
  return DEFAULT_REQUIRE_WALLET
}
