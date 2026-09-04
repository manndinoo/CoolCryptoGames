import { describe, expect, it } from 'vitest'
import { pickSave, progress } from '@/lib/play/save-sync'

describe('pickSave', () => {
  it('hands back the wallet’s save when it is the one with progress', () => {
    const r = pickSave({ local: {}, remote: { level: '12' } })
    expect(r).toEqual({ values: { level: '12' }, source: 'remote', needsUpload: false })
  })

  it('keeps a device’s progress when the wallet has none, and uploads it', () => {
    // Signing in for the first time after playing signed out must not throw
    // away what was already played.
    const r = pickSave({ local: { level: '12' }, remote: {} })
    expect(r).toEqual({ values: { level: '12' }, source: 'local', needsUpload: true })
  })

  it('never trades more progress for less', () => {
    // A fresh phone with an empty save must not overwrite fifty levels.
    const r = pickSave({ local: { level: '2' }, remote: { level: '50' } })
    expect(r.values).toEqual({ level: '50' })
    expect(r.needsUpload).toBe(false)
  })

  it('prefers the device when it is genuinely further along', () => {
    const r = pickSave({ local: { level: '50' }, remote: { level: '2' } })
    expect(r.values).toEqual({ level: '50' })
    expect(r.needsUpload).toBe(true)
  })

  it('does not write on every launch when the two agree', () => {
    const r = pickSave({ local: { level: '9' }, remote: { level: '9' } })
    expect(r.needsUpload).toBe(false)
  })

  it('reports an empty pair as empty rather than uploading nothing', () => {
    expect(pickSave({ local: null, remote: null })).toEqual({
      values: {},
      source: 'empty',
      needsUpload: false,
    })
  })
})

describe('progress', () => {
  it('adds up numeric counters', () => {
    expect(progress({ level: '10', coins: '5' })).toBe(15)
  })

  it('counts a non-numeric setting as some progress, so preferences beat nothing', () => {
    expect(progress({ difficulty: 'chaos' })).toBe(1)
    expect(progress({})).toBe(0)
  })

  it('does not let a negative or malformed value subtract progress', () => {
    expect(progress({ a: '-99' })).toBe(1)
  })
})
