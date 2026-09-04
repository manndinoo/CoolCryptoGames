import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  MAX_SAVE_KEYS,
  MAX_SAVE_KEY_LENGTH,
  MAX_SAVE_VALUE_LENGTH,
  SAVE_CHANNEL,
  SAVE_KEY_PREFIX,
  parseFrameSaveMessage,
  readSave,
  writeSave,
  type SaveValues,
} from '@/lib/play/save-bridge'
import { demoGames, getDemoGame, getDemoDeveloper } from '@/lib/content/demo'
import { hasVerifiedScoring } from '@/lib/anticheat/registry'

const GAME_DIR = join(process.cwd(), 'public', 'games', 'signal-brawl')

function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed))
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    dump: () => Object.fromEntries(map),
  }
}

function message(over: Record<string, unknown> = {}) {
  return { channel: SAVE_CHANNEL, type: 'SAVE_WRITE', values: { a: '1' }, ...over }
}

describe('frame save messages', () => {
  it('accepts a load request', () => {
    const parsed = parseFrameSaveMessage({ channel: SAVE_CHANNEL, type: 'SAVE_LOAD' })
    expect(parsed).toEqual({ ok: true, message: { type: 'SAVE_LOAD' } })
  })

  it('accepts a write of string values', () => {
    const parsed = parseFrameSaveMessage(message({ values: { signalBrawlUnlocked: '3' } }))
    expect(parsed.ok && parsed.message).toEqual({
      type: 'SAVE_WRITE',
      values: { signalBrawlUnlocked: '3' },
    })
  })

  it.each([
    ['a non-object', 'nope', 'not_an_object'],
    ['null', null, 'not_an_object'],
    ['another channel', message({ channel: 'something-else' }), 'wrong_channel'],
    ['an unknown type', message({ type: 'SAVE_DROP_TABLES' }), 'unknown_type'],
    ['an array of values', message({ values: ['1'] }), 'values_invalid'],
    ['a null values bag', message({ values: null }), 'values_invalid'],
  ])('rejects %s', (_label, raw, reason) => {
    expect(parseFrameSaveMessage(raw)).toEqual({ ok: false, reason })
  })

  it('rejects a value that is not a string', () => {
    // Strings only. A save that can nest objects is a save that can carry a
    // payload, and every game here stores scalars.
    expect(parseFrameSaveMessage(message({ values: { a: { b: 1 } } }))).toEqual({
      ok: false,
      reason: 'values_invalid',
    })
  })

  it('rejects more keys than a save should ever hold', () => {
    const values: SaveValues = {}
    for (let i = 0; i <= MAX_SAVE_KEYS; i++) values[`k${i}`] = '1'
    expect(parseFrameSaveMessage(message({ values }))).toEqual({
      ok: false,
      reason: 'too_many_keys',
    })
  })

  it('rejects an oversized key', () => {
    const values = { ['k'.repeat(MAX_SAVE_KEY_LENGTH + 1)]: '1' }
    expect(parseFrameSaveMessage(message({ values }))).toEqual({
      ok: false,
      reason: 'key_too_long',
    })
  })

  it('rejects an oversized value', () => {
    const values = { k: 'v'.repeat(MAX_SAVE_VALUE_LENGTH + 1) }
    expect(parseFrameSaveMessage(message({ values }))).toEqual({
      ok: false,
      reason: 'value_too_long',
    })
  })

  it('rejects a payload that would fill the origin quota', () => {
    const values: SaveValues = {}
    for (let i = 0; i < MAX_SAVE_KEYS; i++) values[`k${i}`] = 'v'.repeat(MAX_SAVE_VALUE_LENGTH)
    expect(parseFrameSaveMessage(message({ values }))).toEqual({ ok: false, reason: 'too_large' })
  })
})

describe('save storage', () => {
  it('round-trips a save under a per-slug key', () => {
    const storage = memoryStorage()
    writeSave('signal-brawl', { signalBrawlUnlocked: '2' }, storage)
    expect(storage.dump()).toHaveProperty(`${SAVE_KEY_PREFIX}signal-brawl`)
    expect(readSave('signal-brawl', storage)).toEqual({ signalBrawlUnlocked: '2' })
  })

  it('keeps one game out of another game’s save', () => {
    const storage = memoryStorage()
    writeSave('signal-brawl', { a: '1' }, storage)
    expect(readSave('road-to-bonded', storage)).toEqual({})
  })

  it('returns an empty save rather than throwing on junk', () => {
    // A corrupt save should cost a player their progress, not the ability to
    // open the game.
    expect(readSave('signal-brawl', memoryStorage({ [`${SAVE_KEY_PREFIX}signal-brawl`]: '{' }))).toEqual({})
    expect(readSave('signal-brawl', memoryStorage({ [`${SAVE_KEY_PREFIX}signal-brawl`]: '[1,2]' }))).toEqual({})
  })

  it('drops non-string values a hand-edited save picked up', () => {
    const stored = { [`${SAVE_KEY_PREFIX}signal-brawl`]: '{"a":"1","b":7,"c":null}' }
    expect(readSave('signal-brawl', memoryStorage(stored))).toEqual({ a: '1' })
  })

  it('survives storage that throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }
    expect(readSave('signal-brawl', broken)).toEqual({})
    expect(() => writeSave('signal-brawl', { a: '1' }, broken)).not.toThrow()
  })
})

describe('the shipped build', () => {
  it('is the three static files the site frames', () => {
    for (const file of ['index.html', 'game.js', 'styles.css']) {
      expect(readFileSync(join(GAME_DIR, file), 'utf8').length).toBeGreaterThan(0)
    }
  })

  it('loads nothing from off the site', () => {
    // The frame has no network allowance to rely on and the catalogue entry
    // promises a dependency-free build, so nothing may reference a remote host.
    const html = readFileSync(join(GAME_DIR, 'index.html'), 'utf8')
    expect(html).not.toMatch(/(?:src|href)\s*=\s*["']?(?:https?:)?\/\//i)
  })

  it('talks to the host on the save channel the shell listens on', () => {
    // The game is plain JS the bundler never sees, so nothing but a test keeps
    // the two ends of this protocol spelled the same.
    const js = readFileSync(join(GAME_DIR, 'game.js'), 'utf8')
    expect(js).toContain(`"${SAVE_CHANNEL}"`)
    for (const type of ['SAVE_LOAD', 'SAVE_WRITE', 'SAVE_DATA']) expect(js).toContain(type)
  })

  it('never lets a storage failure reach the player', () => {
    // The site frames this game on an opaque origin, where every localStorage
    // call throws. Unguarded, that is a blank screen instead of a game.
    const js = readFileSync(join(GAME_DIR, 'game.js'), 'utf8')
    for (const match of js.matchAll(/localStorage\.(?:getItem|setItem|removeItem)/g)) {
      const before = js.slice(Math.max(0, match.index - 400), match.index)
      expect(before.lastIndexOf('try')).toBeGreaterThan(before.lastIndexOf('} catch'))
    }
  })
})

describe('catalogue', () => {
  it('lists Signal Brawl as playable and real', () => {
    const game = getDemoGame('signal-brawl')
    expect(game?.status).toBe('playable')
    expect(game?.demo).toBe(false)
  })

  it('does not claim a verified score the server cannot produce', () => {
    expect(getDemoGame('signal-brawl')?.scoreVerification).toBe('unranked')
    expect(hasVerifiedScoring('signal-brawl')).toBe(false)
  })

  it('reports no verified players until there are verified sessions', () => {
    expect(getDemoGame('signal-brawl')?.verifiedPlayers).toBe(0)
  })

  it('is attached to the developer that publishes it', () => {
    const game = getDemoGame('signal-brawl')
    expect(getDemoDeveloper(game!.developerSlug)?.gameSlugs).toContain('signal-brawl')
  })

  it('points every image at a file that exists', () => {
    // A card that shows a broken frame is worse than a card with no art, and
    // these paths are strings nothing else checks.
    const game = getDemoGame('signal-brawl')!
    for (const path of [game.cover, ...game.screenshots].filter(Boolean) as string[]) {
      expect(() => readFileSync(join(process.cwd(), 'public', path))).not.toThrow()
    }
  })

  it('gives every catalogue slug a unique entry', () => {
    const slugs = demoGames.map((g) => g.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })
})
