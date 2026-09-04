/**
 * Local saves for games that run in the sandbox.
 *
 * A framed game is loaded with `sandbox="allow-scripts"` and deliberately
 * without `allow-same-origin`, so it runs on an opaque origin where every
 * `localStorage` call throws. That isolation is the point — a game is
 * untrusted code and must not reach this page's cookies, storage or wallet —
 * but it also means a game cannot remember anything at all. Signal Brawl
 * unlocks six levels one win at a time and Road to Bonded has fifty; without
 * somewhere to put a save, every player restarts at the first one forever.
 *
 * So the shell keeps the save on the game's behalf, in its own storage, under
 * a per-slug key. Nothing about this touches scoring: these values are the
 * player's own progress on their own device, they never reach the server, and
 * a ranked result is still whatever the server independently replays. A player
 * who edits them has changed their own save file, which is theirs to edit.
 *
 * Everything crossing the frame boundary is validated here first. The frame is
 * as trustworthy as the open internet, so the caps below are what stop one
 * message filling the origin's storage quota.
 */

export const SAVE_CHANNEL = 'ccg-save'

/** Where a slug's save lives in the shell's own storage. */
export const SAVE_KEY_PREFIX = 'ccg.gamesave.'

/** Caps. A save is a handful of counters, not a content store. */
export const MAX_SAVE_KEYS = 48
export const MAX_SAVE_KEY_LENGTH = 64
export const MAX_SAVE_VALUE_LENGTH = 512
export const MAX_SAVE_BYTES = 16_384

export type SaveValues = Record<string, string>

export type FrameSaveMessage =
  | { type: 'SAVE_LOAD' }
  | { type: 'SAVE_WRITE'; values: SaveValues }

export type SaveParseResult =
  | { ok: true; message: FrameSaveMessage }
  | { ok: false; reason: SaveParseRejection }

export type SaveParseRejection =
  | 'not_an_object'
  | 'wrong_channel'
  | 'unknown_type'
  | 'values_invalid'
  | 'too_many_keys'
  | 'key_too_long'
  | 'value_too_long'
  | 'too_large'

/**
 * Validates a message from the game frame.
 *
 * Unknown types are rejected rather than forwarded. An allow-list is the whole
 * point of a parser here: a protocol that passes through what it does not
 * recognise grows a new surface every time a game invents a message.
 */
export type ValuesParseResult =
  | { ok: true; values: SaveValues }
  | { ok: false; reason: SaveParseRejection }

/**
 * Validates a save payload, wherever it arrived from.
 *
 * Shared by the frame bridge and by the HTTP route that stores a save against a
 * wallet. A save arriving over HTTP has had exactly as much opportunity to be
 * edited as one arriving by postMessage, so it meets the same limits.
 */
export function parseSaveValues(raw: unknown): ValuesParseResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: 'values_invalid' }
  }

  const entries = Object.entries(raw as Record<string, unknown>)
  if (entries.length > MAX_SAVE_KEYS) return { ok: false, reason: 'too_many_keys' }

  const values: SaveValues = {}
  for (const [key, value] of entries) {
    if (key.length === 0 || key.length > MAX_SAVE_KEY_LENGTH) {
      return { ok: false, reason: 'key_too_long' }
    }
    // Strings only. A save that can carry nested objects is a save that can
    // carry a payload, and every one of these games stores scalars.
    if (typeof value !== 'string') return { ok: false, reason: 'values_invalid' }
    if (value.length > MAX_SAVE_VALUE_LENGTH) return { ok: false, reason: 'value_too_long' }
    values[key] = value
  }

  if (JSON.stringify(values).length > MAX_SAVE_BYTES) return { ok: false, reason: 'too_large' }

  return { ok: true, values }
}

export function parseFrameSaveMessage(raw: unknown): SaveParseResult {
  if (typeof raw !== 'object' || raw === null) return fail('not_an_object')
  const msg = raw as Record<string, unknown>

  if (msg.channel !== SAVE_CHANNEL) return fail('wrong_channel')

  if (msg.type === 'SAVE_LOAD') return { ok: true, message: { type: 'SAVE_LOAD' } }
  if (msg.type !== 'SAVE_WRITE') return fail('unknown_type')

  const parsed = parseSaveValues(msg.values)
  if (!parsed.ok) return fail(parsed.reason)

  return { ok: true, message: { type: 'SAVE_WRITE', values: parsed.values } }
}

/**
 * Reads a slug's save out of the shell's storage.
 *
 * Returns an empty save for anything unreadable — absent, unparseable, or
 * written by an older build with a different shape. A corrupt save should cost
 * a player their progress, not the ability to open the game.
 */
export function readSave(slug: string, storage: Pick<Storage, 'getItem'>): SaveValues {
  let raw: string | null
  try {
    raw = storage.getItem(SAVE_KEY_PREFIX + slug)
  } catch {
    return {}
  }
  if (!raw) return {}

  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const values: SaveValues = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string' && value.length <= MAX_SAVE_VALUE_LENGTH) values[key] = value
    }
    return values
  } catch {
    return {}
  }
}

/**
 * Writes a slug's save. Silently does nothing where storage is unavailable —
 * a private window should still be able to play, just without remembering.
 */
export function writeSave(
  slug: string,
  values: SaveValues,
  storage: Pick<Storage, 'setItem'>,
): void {
  try {
    storage.setItem(SAVE_KEY_PREFIX + slug, JSON.stringify(values))
  } catch {
    /* quota, private mode, or storage disabled */
  }
}

function fail(reason: SaveParseRejection): SaveParseResult {
  return { ok: false, reason }
}
