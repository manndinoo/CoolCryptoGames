import { describe, expect, it } from 'vitest'
import {
  hashFingerprint,
  normalizeComponents,
  similarity,
  type FingerprintComponents,
} from '@/lib/security/fingerprint'

const base: FingerprintComponents = {
  platform: 'macintel',
  timezone: 'europe/london',
  screen: '1920x1080x24',
  cores: '8',
  canvas: 'a1b2c3',
  webgl: 'd4e5f6',
}

describe('normalizeComponents', () => {
  it('accepts a complete payload', () => {
    expect(normalizeComponents({ ...base })).toEqual(base)
  })

  it('lowercases and trims so casing does not split one device in two', () => {
    const n = normalizeComponents({ ...base, platform: '  MacIntel  ' })
    expect(n?.platform).toBe('macintel')
  })

  it('rejects a payload missing a field', () => {
    const { canvas, ...partial } = base
    void canvas
    expect(normalizeComponents(partial)).toBeNull()
  })

  it('rejects non-string values rather than coercing them', () => {
    expect(normalizeComponents({ ...base, cores: 8 })).toBeNull()
  })

  it('rejects non-objects', () => {
    expect(normalizeComponents(null)).toBeNull()
    expect(normalizeComponents('nope')).toBeNull()
  })

  it('caps field length so a client cannot bloat the hash input', () => {
    const n = normalizeComponents({ ...base, canvas: 'x'.repeat(5000) })
    expect(n?.canvas.length).toBe(256)
  })
})

describe('hashFingerprint', () => {
  it('is stable for the same components', async () => {
    expect(await hashFingerprint(base)).toBe(await hashFingerprint({ ...base }))
  })

  it('changes when any component changes', async () => {
    expect(await hashFingerprint({ ...base, canvas: 'different' })).not.toBe(
      await hashFingerprint(base),
    )
  })

  it('does not leak the raw components', async () => {
    const hash = await hashFingerprint(base)
    expect(hash).not.toContain('macintel')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('does not confuse two devices that differ only in field boundaries', async () => {
    // Naive concatenation would hash "ab"+"c" and "a"+"bc" identically.
    const a = await hashFingerprint({ ...base, platform: 'ab', timezone: 'c' })
    const b = await hashFingerprint({ ...base, platform: 'a', timezone: 'bc' })
    expect(a).not.toBe(b)
  })
})

describe('similarity', () => {
  it('is 1 for identical devices', () => {
    expect(similarity(base, { ...base })).toBe(1)
  })

  it('reports a near miss, as after a browser update', () => {
    expect(similarity(base, { ...base, cores: '16' })).toBeCloseTo(5 / 6)
  })
})
