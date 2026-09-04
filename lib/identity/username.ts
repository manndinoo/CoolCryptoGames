/**
 * Usernames.
 *
 * A wallet address is the credential, never the public identity. Addresses are
 * frequently deanonymisable on-chain — balances, counterparties and history are
 * all public — so putting one on a leaderboard publishes far more about a
 * player than a name does. Every public surface shows the username; the address
 * is shown only back to the person who controls it.
 *
 * Pure functions, so the rules are testable without a database.
 */

export const MIN_USERNAME_LENGTH = 3
export const MAX_USERNAME_LENGTH = 20

export type UsernameRejection =
  | 'too_short'
  | 'too_long'
  | 'invalid_characters'
  | 'must_start_with_letter'
  | 'repeated_underscore'
  | 'reserved'

export type UsernameCheck =
  | { valid: true; username: string; key: string }
  | { valid: false; reason: UsernameRejection }

/**
 * ASCII only, deliberately.
 *
 * Allowing the full Unicode letter range would let someone register a name
 * using Cyrillic "а" or Greek "ο" that renders identically to an existing one.
 * Impersonation on a leaderboard or in chat is the whole risk, and restricting
 * the alphabet removes that class of attack outright rather than trying to
 * detect it after the fact.
 */
const SHAPE = /^[a-zA-Z][a-zA-Z0-9_]*$/

const RESERVED = new Set([
  'admin',
  'administrator',
  'mod',
  'moderator',
  'staff',
  'support',
  'help',
  'system',
  'root',
  'official',
  'ccg',
  'ccgofficial',
  'coolcryptogames',
  'anonymous',
  'deleted',
  'null',
  'undefined',
  'me',
  'api',
  'www',
])

/**
 * Collapses a name to the shape an impersonator is aiming at.
 *
 * Underscores come out and the common letter-for-digit substitutions are
 * reversed, so "ccg_0ffici4l" and "m0d" resolve to "ccgofficial" and "mod".
 * Checking this alongside the literal name is what stops the reserved list
 * being sidestepped with a single character swap.
 */
export function impersonationKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/_/g, '')
    .replace(/0/g, 'o')
    .replace(/1/g, 'l')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
}

/**
 * Validates a proposed username.
 *
 * Returns the display form the player typed, plus `key` — the lowercase form
 * used for uniqueness. Uniqueness must be case-insensitive or "Alice" and
 * "alice" become two accounts that are indistinguishable on screen.
 */
export function checkUsername(raw: string): UsernameCheck {
  const username = raw.trim()

  if (username.length < MIN_USERNAME_LENGTH) return { valid: false, reason: 'too_short' }
  if (username.length > MAX_USERNAME_LENGTH) return { valid: false, reason: 'too_long' }

  if (!/^[a-zA-Z]/.test(username)) return { valid: false, reason: 'must_start_with_letter' }
  if (!SHAPE.test(username)) return { valid: false, reason: 'invalid_characters' }

  // "a__b" and "a_b" read as the same name at a glance.
  if (username.includes('__')) return { valid: false, reason: 'repeated_underscore' }

  const key = username.toLowerCase()
  if (RESERVED.has(key) || RESERVED.has(impersonationKey(username))) {
    return { valid: false, reason: 'reserved' }
  }

  return { valid: true, username, key }
}

const REJECTION_COPY: Record<UsernameRejection, string> = {
  too_short: `Usernames are at least ${MIN_USERNAME_LENGTH} characters.`,
  too_long: `Usernames are at most ${MAX_USERNAME_LENGTH} characters.`,
  invalid_characters: 'Use letters, numbers and underscores only.',
  must_start_with_letter: 'Usernames start with a letter.',
  repeated_underscore: 'Use single underscores only.',
  reserved: 'That name is reserved.',
}

export function usernameRejectionMessage(reason: UsernameRejection): string {
  return REJECTION_COPY[reason]
}

/**
 * How a player is shown in public.
 *
 * The fallback exists because an account can be authenticated before it has
 * chosen a name, and no public surface may fall back to the address — doing so
 * would leak exactly what the username is here to protect.
 */
export function displayName(username: string | null): string {
  return username ?? 'Unnamed player'
}
