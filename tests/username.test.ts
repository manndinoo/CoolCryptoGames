import { describe, expect, it } from 'vitest'
import {
  checkUsername,
  displayName,
  impersonationKey,
  MAX_USERNAME_LENGTH,
} from '@/lib/identity/username'

describe('checkUsername', () => {
  it('accepts an ordinary name and returns a lowercase uniqueness key', () => {
    expect(checkUsername('ReflexKing')).toEqual({
      valid: true,
      username: 'ReflexKing',
      key: 'reflexking',
    })
  })

  it('trims surrounding whitespace', () => {
    expect(checkUsername('  player_one  ')).toMatchObject({ valid: true, username: 'player_one' })
  })

  it('keys case-insensitively so two spellings cannot both exist', () => {
    // "Alice" and "alice" would be indistinguishable on a leaderboard.
    const a = checkUsername('Alice')
    const b = checkUsername('alice')
    expect(a.valid && b.valid && a.key === b.key).toBe(true)
  })

  it('rejects names that are too short or too long', () => {
    expect(checkUsername('ab')).toEqual({ valid: false, reason: 'too_short' })
    expect(checkUsername('a'.repeat(MAX_USERNAME_LENGTH + 1))).toEqual({
      valid: false,
      reason: 'too_long',
    })
  })

  it('requires a leading letter', () => {
    expect(checkUsername('1player')).toEqual({ valid: false, reason: 'must_start_with_letter' })
    expect(checkUsername('_player')).toEqual({ valid: false, reason: 'must_start_with_letter' })
  })

  it('rejects punctuation and spaces', () => {
    expect(checkUsername('player one')).toEqual({ valid: false, reason: 'invalid_characters' })
    expect(checkUsername('player-one')).toEqual({ valid: false, reason: 'invalid_characters' })
  })

  it('rejects non-ASCII letters that render like ASCII ones', () => {
    // Cyrillic "а" is visually identical to Latin "a". Allowing it would let
    // someone register a name indistinguishable from an existing player's.
    const cyrillicA = String.fromCharCode(0x0430)
    expect(checkUsername(`Alice${cyrillicA}`)).toEqual({
      valid: false,
      reason: 'invalid_characters',
    })
  })

  it('rejects doubled underscores', () => {
    expect(checkUsername('a__b')).toEqual({ valid: false, reason: 'repeated_underscore' })
  })

  it('rejects reserved names', () => {
    expect(checkUsername('admin')).toEqual({ valid: false, reason: 'reserved' })
    expect(checkUsername('CCG')).toEqual({ valid: false, reason: 'reserved' })
  })

  it('rejects reserved names disguised with digit substitutions', () => {
    // A reserved list checked literally is sidestepped by one character.
    expect(checkUsername('ccg_0fficial')).toEqual({ valid: false, reason: 'reserved' })
    expect(checkUsername('m0d')).toEqual({ valid: false, reason: 'reserved' })
    expect(checkUsername('Supp0rt')).toEqual({ valid: false, reason: 'reserved' })
  })

  it('does not over-reject ordinary names that merely contain a reserved word', () => {
    expect(checkUsername('admiral').valid).toBe(true)
    expect(checkUsername('modest_gamer').valid).toBe(true)
  })
})

describe('impersonationKey', () => {
  it('collapses substitutions and underscores', () => {
    expect(impersonationKey('CCG_0ffici4l')).toBe('ccgofficial')
  })

  it('leaves an ordinary name recognisable', () => {
    expect(impersonationKey('ReflexKing')).toBe('reflexking')
  })
})

describe('displayName', () => {
  it('uses the username when there is one', () => {
    expect(displayName('ReflexKing')).toBe('ReflexKing')
  })

  it('never falls back to anything address-shaped', () => {
    // An account can be authenticated before it has picked a name. Falling back
    // to the wallet would leak precisely what the username exists to protect.
    expect(displayName(null)).toBe('Unnamed player')
  })
})
