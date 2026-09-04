import type { SaveValues } from './save-bridge'

/**
 * Which save a game should be handed when it starts.
 *
 * Two copies can exist: one on the device, from playing signed out or on this
 * browser before, and one against the wallet. They are not ranked by recency,
 * because neither carries a trustworthy clock — the device's is the player's own
 * and the server's is only stamped when it was written, not when it was played.
 *
 * They are ranked by progress instead. A save with more in it is the one a
 * player would be upset to lose, and choosing it can only ever hand someone
 * more of their own game, never less. The failure mode of the alternative —
 * signing in on a new phone and overwriting fifty levels with an empty save —
 * is the one that actually matters.
 */
export type SavePick = {
  values: SaveValues
  /** Which copy won, and therefore whether the other needs updating. */
  source: 'remote' | 'local' | 'empty'
  /** True when the winning copy is not what the server holds. */
  needsUpload: boolean
}

export function pickSave(args: {
  local: SaveValues | null
  remote: SaveValues | null
}): SavePick {
  const local = args.local ?? {}
  const remote = args.remote ?? {}
  const localScore = progress(local)
  const remoteScore = progress(remote)

  if (remoteScore === 0 && localScore === 0) {
    return { values: {}, source: 'empty', needsUpload: false }
  }

  // Ties go to the server, so a device that is already in step does not
  // generate a pointless write on every launch.
  if (remoteScore >= localScore) {
    return { values: remote, source: 'remote', needsUpload: false }
  }
  return { values: local, source: 'local', needsUpload: true }
}

/**
 * How much game is in a save.
 *
 * Sums the numeric values and counts the rest. Every one of these games stores
 * progress as counters — levels unlocked, best streak, currency — so a larger
 * total is more progress. Non-numeric entries are settings, which are worth one
 * point each so that a save carrying only preferences still beats nothing.
 */
export function progress(values: SaveValues): number {
  let total = 0
  for (const value of Object.values(values)) {
    const n = Number(value)
    total += Number.isFinite(n) && n > 0 ? n : 1
  }
  return total
}
