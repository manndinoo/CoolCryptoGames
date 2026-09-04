/**
 * ZERO SIGNAL — the parts of the game that are not drawing.
 *
 * Levels, the trail catalogue, the daily allowances and every shop transaction
 * live here as pure functions over a save file. The canvas component owns the
 * simulation and the pixels; it owns none of the economy.
 *
 * That split is deliberate. In the standalone handoff build these rules were
 * inline `setSave` callbacks that also fired toasts, so the daily limits — the
 * one part players will try to get around — could not be tested without a
 * browser. Here they are ordinary functions with ordinary tests.
 *
 * Note what this module is NOT: it is not a server-side replay. Scores from
 * this game are unranked, because the run itself is not reproducible from an
 * input log (see `lib/anticheat/types.ts` for what verified scoring requires).
 * Everything below runs on the player's own device against their own save.
 */

export type PowerKind = 'wide' | 'phase' | 'revive'
export type ActivePower = 'wide' | 'phase'
export type Currency = 'chips' | 'credits'

export type Theme = {
  name: string
  top: string
  bottom: string
  gate: string
  accent: string
  deco: 'grid' | 'sun' | 'pipes' | 'snow' | 'stars' | 'speed'
}

export type Trail = {
  id: string
  name: string
  color: string
  price: number
  kind: 'comet' | 'echo' | 'spark' | 'pixel' | 'plasma'
  note: string
}

export type Save = {
  best: number
  chips: number
  credits: number
  games: number
  skin: string
  owned: string[]
  streak: number
  powerUps: Record<PowerKind, number>
  /** Day key of the last power-up bought with chips. One per day. */
  lastChipPowerBuy: string
  /** Day key of the last launch that granted the free daily Revive. */
  lastDailyRevive: string
  /** Day key the Revive purchase counter below belongs to. */
  reviveBuyDate: string
  reviveBuys: number
}

/** A rule application: the next save, and what to tell the player about it. */
export type Outcome = { save: Save; notice: string | null }

export const SAVE_KEY = 'zero-signal-save'

/** One theme per level, cycling. Level 7 looks like level 1 again. */
export const THEMES: readonly Theme[] = [
  { name: 'NEON GRID', top: '#19072d', bottom: '#03030a', gate: '#ff3f92', accent: '#55eaff', deco: 'grid' },
  { name: 'SUNSET DRIVE', top: '#5b163f', bottom: '#12051e', gate: '#ff884d', accent: '#ffd166', deco: 'sun' },
  { name: 'TOXIC PLANT', top: '#102817', bottom: '#020b08', gate: '#8cff42', accent: '#23f0c7', deco: 'pipes' },
  { name: 'ICE CIRCUIT', top: '#092b4a', bottom: '#020713', gate: '#65dfff', accent: '#bdeaff', deco: 'snow' },
  { name: 'DEEP SPACE', top: '#1d1239', bottom: '#010107', gate: '#a879ff', accent: '#ff69c8', deco: 'stars' },
  { name: 'REDLINE', top: '#3b080d', bottom: '#0b0203', gate: '#ff334d', accent: '#ffbd33', deco: 'speed' },
]

export const TRAILS: readonly Trail[] = [
  { id: 'classic', name: 'COMET', color: '#55eaff', price: 0, kind: 'comet', note: 'Smooth neon tail' },
  { id: 'echo', name: 'ECHO ORBS', color: '#ff4fa7', price: 250, kind: 'echo', note: 'Ghost balls follow' },
  { id: 'spark', name: 'LIVE WIRE', color: '#8cff42', price: 600, kind: 'spark', note: 'Electric sparks' },
  { id: 'pixel', name: 'PIXEL DUST', color: '#ffd166', price: 900, kind: 'pixel', note: 'Retro block trail' },
  { id: 'plasma', name: 'PLASMA TWIN', color: '#a879ff', price: 1400, kind: 'plasma', note: 'Double energy ribbon' },
]

/** Chip prices. Each is also capped by a daily allowance, below. */
export const CHIP_PRICE: Record<PowerKind, number> = { wide: 300, phase: 650, revive: 900 }
/** Credit prices. Credits cannot be bought — see `PREMIUM_LOCKED`. */
export const CREDIT_PRICE: Record<PowerKind, number> = { wide: 5, phase: 12, revive: 18 }

/** Chip-bought Revives per day. Separate from the one standard power-up buy. */
export const REVIVE_BUYS_PER_DAY = 2

/**
 * Real-money and premium Credit purchases are locked.
 *
 * The game arrived from the handoff with its store already locked for beta, and
 * this platform keeps it locked for a second, independent reason: paid anything
 * is gated behind FEATURE_PAYMENTS, which is off. The credit prices above stay
 * in the model so the economy is complete and testable; no UI spends them.
 */
export const PREMIUM_LOCKED = true

export const initialSave: Save = {
  best: 0,
  chips: 120,
  credits: 20,
  games: 0,
  skin: 'classic',
  owned: ['classic'],
  streak: 1,
  powerUps: { wide: 0, phase: 0, revive: 0 },
  lastChipPowerBuy: '',
  lastDailyRevive: '',
  reviveBuyDate: '',
  reviveBuys: 0,
}

/** `#rrggbb` plus an alpha, for canvas fills. */
export function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${alpha})`
}

/** Local calendar day. Daily allowances follow the player's own midnight. */
export function dayKey(date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/**
 * Which level a run is on after clearing `passed` gates.
 *
 * Level 1 is ten gates, and each level after it is three gates longer than the
 * last, up to twenty-eight. Levels therefore arrive quickly at first and then
 * settle, which is what stops the theme changing every few seconds late in a run.
 */
export function levelForGates(passed: number): { level: number; progress: number; length: number } {
  let level = 0
  let start = 0
  let length = 10
  while (passed >= start + length) {
    start += length
    level++
    length = Math.min(28, 10 + level * 3)
  }
  return { level, progress: passed - start, length }
}

export function themeForLevel(level: number): Theme {
  return THEMES[level % THEMES.length]
}

export function trailById(id: string): Trail {
  return TRAILS.find((trail) => trail.id === id) ?? TRAILS[0]
}

/**
 * Rebuild a save from whatever was in storage.
 *
 * Anything unreadable, or from an older shape, falls back field by field rather
 * than wiping the file — a player who has bought trails should not lose them to
 * a schema change.
 */
export function parseSave(raw: string | null): Save {
  let stored: Partial<Save> = {}
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') stored = parsed as Partial<Save>
    } catch {
      // Corrupt save. Start clean rather than refusing to launch.
    }
  }
  return {
    ...initialSave,
    ...stored,
    owned: Array.isArray(stored.owned) ? stored.owned : initialSave.owned,
    powerUps: { ...initialSave.powerUps, ...stored.powerUps },
  }
}

/** The free Revive granted on the first launch of each local day. */
export function grantDailyRevive(save: Save, today = dayKey()): Outcome {
  if (save.lastDailyRevive === today) return { save, notice: null }
  return {
    save: {
      ...save,
      lastDailyRevive: today,
      powerUps: { ...save.powerUps, revive: save.powerUps.revive + 1 },
    },
    notice: 'DAILY REVIVE ADDED',
  }
}

/** How many chip-bought Revives are still available today. */
export function reviveBuysLeft(save: Save, today = dayKey()): number {
  const used = save.reviveBuyDate === today ? save.reviveBuys : 0
  return Math.max(0, REVIVE_BUYS_PER_DAY - used)
}

/** Whether today's single standard power-up purchase has been spent. */
export function standardBuyUsed(save: Save, today = dayKey()): boolean {
  return save.lastChipPowerBuy === today
}

/** Buying a trail equips it. Re-selecting one already owned just equips it. */
export function buyTrail(save: Save, id: string): Outcome {
  const trail = TRAILS.find((entry) => entry.id === id)
  if (!trail) return { save, notice: null }
  if (save.owned.includes(id)) return { save: { ...save, skin: id }, notice: null }
  if (save.chips < trail.price) return { save, notice: 'NOT ENOUGH CHIPS' }
  return {
    save: { ...save, chips: save.chips - trail.price, owned: [...save.owned, id], skin: id },
    notice: 'NEW TRAIL UNLOCKED',
  }
}

/**
 * Bank a Gate Expander or a Ghost Drive.
 *
 * Chips buy one standard power-up per day between them, so a long session
 * cannot be converted straight into a stack of Ghost Drives. Revive has its own
 * separate allowance and is bought through `buyRevive`.
 */
export function buyPowerUp(save: Save, kind: ActivePower, currency: Currency, today = dayKey()): Outcome {
  if (currency === 'chips') {
    if (standardBuyUsed(save, today)) return { save, notice: 'DAILY POWER-UP PURCHASE USED' }
    const price = CHIP_PRICE[kind]
    if (save.chips < price) return { save, notice: 'NOT ENOUGH CHIPS' }
    return {
      save: {
        ...save,
        chips: save.chips - price,
        lastChipPowerBuy: today,
        powerUps: { ...save.powerUps, [kind]: save.powerUps[kind] + 1 },
      },
      notice: 'POWER-UP BANKED',
    }
  }

  const price = CREDIT_PRICE[kind]
  if (save.credits < price) return { save, notice: 'NOT ENOUGH CREDITS' }
  return {
    save: {
      ...save,
      credits: save.credits - price,
      powerUps: { ...save.powerUps, [kind]: save.powerUps[kind] + 1 },
    },
    notice: 'POWER-UP BANKED',
  }
}

/** Bank a Revive. Chips buy at most `REVIVE_BUYS_PER_DAY` of them per day. */
export function buyRevive(save: Save, currency: Currency, today = dayKey()): Outcome {
  if (currency === 'chips') {
    if (reviveBuysLeft(save, today) <= 0) return { save, notice: 'DAILY REVIVE LIMIT USED' }
    if (save.chips < CHIP_PRICE.revive) return { save, notice: 'NOT ENOUGH CHIPS' }
    const used = save.reviveBuyDate === today ? save.reviveBuys : 0
    return {
      save: {
        ...save,
        chips: save.chips - CHIP_PRICE.revive,
        reviveBuyDate: today,
        reviveBuys: used + 1,
        powerUps: { ...save.powerUps, revive: save.powerUps.revive + 1 },
      },
      notice: 'REVIVE BANKED',
    }
  }

  if (save.credits < CREDIT_PRICE.revive) return { save, notice: 'NOT ENOUGH CREDITS' }
  return {
    save: {
      ...save,
      credits: save.credits - CREDIT_PRICE.revive,
      powerUps: { ...save.powerUps, revive: save.powerUps.revive + 1 },
    },
    notice: 'REVIVE BANKED',
  }
}

/** Fold a finished run into the save: best score, chips earned, run count. */
export function recordRun(save: Save, run: { score: number; chips: number }): Save {
  return {
    ...save,
    best: Math.max(save.best, run.score),
    chips: save.chips + run.chips,
    games: save.games + 1,
  }
}
