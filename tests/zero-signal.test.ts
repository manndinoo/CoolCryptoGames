import { describe, expect, it } from 'vitest'
import {
  CHIP_PRICE,
  CREDIT_PRICE,
  REVIVE_BUYS_PER_DAY,
  TRAILS,
  buyPowerUp,
  buyRevive,
  buyTrail,
  dayKey,
  grantDailyRevive,
  initialSave,
  levelForGates,
  parseSave,
  recordRun,
  reviveBuysLeft,
  rgba,
  standardBuyUsed,
  themeForLevel,
  trailById,
  type Save,
} from '@/lib/games/zero-signal/rules'
import { demoGames, getDemoGame } from '@/lib/content/demo'
import { hasVerifiedScoring } from '@/lib/anticheat/registry'

const TODAY = '2026-09-04'
const TOMORROW = '2026-09-05'

function saveWith(overrides: Partial<Save>): Save {
  return { ...initialSave, ...overrides, powerUps: { ...initialSave.powerUps, ...overrides.powerUps } }
}

describe('levels', () => {
  it('starts on level 1 and runs ten gates', () => {
    expect(levelForGates(0)).toEqual({ level: 0, progress: 0, length: 10 })
    expect(levelForGates(9)).toEqual({ level: 0, progress: 9, length: 10 })
  })

  it('advances a level once the current one is cleared', () => {
    expect(levelForGates(10).level).toBe(1)
    // Level 2 is thirteen gates, so level 3 starts at 23.
    expect(levelForGates(22).level).toBe(1)
    expect(levelForGates(23).level).toBe(2)
  })

  it('stops lengthening levels at twenty-eight gates', () => {
    const long = levelForGates(5_000)
    expect(long.length).toBe(28)
    expect(long.progress).toBeLessThan(28)
  })

  it('never reports progress past the level length', () => {
    for (let passed = 0; passed < 400; passed++) {
      const state = levelForGates(passed)
      expect(state.progress).toBeGreaterThanOrEqual(0)
      expect(state.progress).toBeLessThan(state.length)
    }
  })

  it('cycles the six worlds', () => {
    expect(themeForLevel(0).name).toBe('NEON GRID')
    expect(themeForLevel(6)).toBe(themeForLevel(0))
  })
})

describe('save loading', () => {
  it('falls back to a fresh save when storage is empty or corrupt', () => {
    expect(parseSave(null)).toEqual(initialSave)
    expect(parseSave('not json')).toEqual(initialSave)
  })

  it('keeps stored progress and fills in fields a older save lacks', () => {
    const stored = parseSave(JSON.stringify({ best: 900, chips: 40, owned: ['classic', 'echo'] }))
    expect(stored.best).toBe(900)
    expect(stored.chips).toBe(40)
    expect(stored.owned).toEqual(['classic', 'echo'])
    // Absent in the stored file, so it comes from the defaults rather than undefined.
    expect(stored.powerUps).toEqual({ wide: 0, phase: 0, revive: 0 })
    expect(stored.skin).toBe('classic')
  })

  it('refuses a non-array owned list rather than crashing the shop', () => {
    expect(parseSave(JSON.stringify({ owned: 'classic' })).owned).toEqual(['classic'])
  })
})

describe('daily revive', () => {
  it('grants one on the first launch of a day', () => {
    const first = grantDailyRevive(initialSave, TODAY)
    expect(first.save.powerUps.revive).toBe(1)
    expect(first.notice).toBe('DAILY REVIVE ADDED')
  })

  it('grants nothing on a second launch the same day', () => {
    const first = grantDailyRevive(initialSave, TODAY)
    const second = grantDailyRevive(first.save, TODAY)
    expect(second.save).toBe(first.save)
    expect(second.notice).toBeNull()
  })

  it('grants again the next day', () => {
    const first = grantDailyRevive(initialSave, TODAY)
    const next = grantDailyRevive(first.save, TOMORROW)
    expect(next.save.powerUps.revive).toBe(2)
  })
})

describe('trails', () => {
  it('buys, equips and deducts once', () => {
    const echo = TRAILS[1]
    const { save, notice } = buyTrail(saveWith({ chips: echo.price }), echo.id)
    expect(notice).toBe('NEW TRAIL UNLOCKED')
    expect(save.chips).toBe(0)
    expect(save.owned).toContain(echo.id)
    expect(save.skin).toBe(echo.id)
  })

  it('re-equips an owned trail for free', () => {
    const owned = saveWith({ chips: 0, owned: ['classic', 'echo'], skin: 'classic' })
    const { save, notice } = buyTrail(owned, 'echo')
    expect(save.skin).toBe('echo')
    expect(save.chips).toBe(0)
    expect(notice).toBeNull()
  })

  it('refuses a trail the player cannot afford', () => {
    const broke = saveWith({ chips: 10 })
    const { save, notice } = buyTrail(broke, 'plasma')
    expect(save).toBe(broke)
    expect(notice).toBe('NOT ENOUGH CHIPS')
  })

  it('falls back to the default trail for an unknown id', () => {
    expect(trailById('no-such-trail').id).toBe('classic')
  })
})

describe('power-up purchases', () => {
  it('banks one power-up and spends the chips', () => {
    const { save, notice } = buyPowerUp(saveWith({ chips: 1_000 }), 'wide', 'chips', TODAY)
    expect(notice).toBe('POWER-UP BANKED')
    expect(save.chips).toBe(1_000 - CHIP_PRICE.wide)
    expect(save.powerUps.wide).toBe(1)
  })

  it('allows only one chip purchase per day, across both power-ups', () => {
    const rich = saveWith({ chips: 10_000 })
    const first = buyPowerUp(rich, 'wide', 'chips', TODAY)
    expect(standardBuyUsed(first.save, TODAY)).toBe(true)

    // A different power-up does not get its own allowance.
    const second = buyPowerUp(first.save, 'phase', 'chips', TODAY)
    expect(second.notice).toBe('DAILY POWER-UP PURCHASE USED')
    expect(second.save).toBe(first.save)

    const nextDay = buyPowerUp(first.save, 'phase', 'chips', TOMORROW)
    expect(nextDay.save.powerUps.phase).toBe(1)
  })

  it('refuses a purchase the player cannot afford, and spends no allowance', () => {
    const broke = saveWith({ chips: CHIP_PRICE.phase - 1 })
    const { save, notice } = buyPowerUp(broke, 'phase', 'chips', TODAY)
    expect(notice).toBe('NOT ENOUGH CHIPS')
    expect(save).toBe(broke)
    expect(standardBuyUsed(save, TODAY)).toBe(false)
  })

  it('does not apply the daily chip limit to credits', () => {
    const funded = saveWith({ credits: 100, lastChipPowerBuy: TODAY })
    const { save } = buyPowerUp(funded, 'wide', 'credits', TODAY)
    expect(save.credits).toBe(100 - CREDIT_PRICE.wide)
    expect(save.powerUps.wide).toBe(1)
  })
})

describe('revive purchases', () => {
  it('allows two chip purchases a day and refuses the third', () => {
    let save = saveWith({ chips: 10_000 })
    for (let i = 0; i < REVIVE_BUYS_PER_DAY; i++) {
      const result = buyRevive(save, 'chips', TODAY)
      expect(result.notice).toBe('REVIVE BANKED')
      save = result.save
    }
    expect(save.powerUps.revive).toBe(REVIVE_BUYS_PER_DAY)
    expect(reviveBuysLeft(save, TODAY)).toBe(0)

    const overLimit = buyRevive(save, 'chips', TODAY)
    expect(overLimit.notice).toBe('DAILY REVIVE LIMIT USED')
    expect(overLimit.save).toBe(save)
  })

  it('resets the revive allowance the next day', () => {
    const spent = saveWith({ chips: 10_000, reviveBuyDate: TODAY, reviveBuys: REVIVE_BUYS_PER_DAY })
    expect(reviveBuysLeft(spent, TODAY)).toBe(0)
    expect(reviveBuysLeft(spent, TOMORROW)).toBe(REVIVE_BUYS_PER_DAY)
    expect(buyRevive(spent, 'chips', TOMORROW).save.reviveBuys).toBe(1)
  })

  it('does not consume the standard power-up allowance', () => {
    const { save } = buyRevive(saveWith({ chips: 10_000 }), 'chips', TODAY)
    expect(standardBuyUsed(save, TODAY)).toBe(false)
  })
})

describe('finishing a run', () => {
  it('keeps the best score, adds the chips and counts the run', () => {
    const before = saveWith({ best: 500, chips: 20, games: 3 })
    const after = recordRun(before, { score: 640, chips: 12 })
    expect(after).toMatchObject({ best: 640, chips: 32, games: 4 })
  })

  it('does not lower an existing best', () => {
    expect(recordRun(saveWith({ best: 900 }), { score: 100, chips: 0 }).best).toBe(900)
  })
})

describe('helpers', () => {
  it('formats a hex colour with alpha', () => {
    expect(rgba('#55eaff', 0.5)).toBe('rgba(85,234,255,0.5)')
  })

  it('formats a local day key, zero-padded', () => {
    expect(dayKey(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})

describe('catalogue', () => {
  it('lists ZERO SIGNAL as playable', () => {
    const game = getDemoGame('zero-signal')
    expect(game?.status).toBe('playable')
    expect(game?.demo).toBe(false)
  })

  it('does not claim a verified score the server cannot produce', () => {
    // The one rule that has to hold for the whole catalogue: a game may only
    // advertise deterministic replay if the server can actually replay it.
    for (const game of demoGames) {
      if (game.scoreVerification === 'deterministic-replay') continue
      expect(hasVerifiedScoring(game.slug)).toBe(false)
    }
    expect(getDemoGame('zero-signal')?.scoreVerification).toBe('unranked')
  })

  it('reports no verified players for a game with no verified sessions', () => {
    expect(getDemoGame('zero-signal')?.verifiedPlayers).toBe(0)
  })
})
