import { afterEach, describe, expect, it } from 'vitest'
import { walletRequiredToPlay } from '@/lib/play/access'

const KEY = 'CCG_REQUIRE_WALLET_TO_PLAY'

afterEach(() => {
  delete process.env[KEY]
})

describe('walletRequiredToPlay', () => {
  it('is off unless something turns it on', () => {
    delete process.env[KEY]
    expect(walletRequiredToPlay()).toBe(false)
  })

  it('is put back by the exact string "true"', () => {
    process.env[KEY] = 'true'
    expect(walletRequiredToPlay()).toBe(true)
  })

  it('is turned off by the exact string "false"', () => {
    process.env[KEY] = 'false'
    expect(walletRequiredToPlay()).toBe(false)
  })

  // A variable that was deleted in a hosting dashboard often arrives as an
  // empty string rather than as absent, and "1"/"yes"/"TRUE" are the spellings
  // someone reaches for from memory. None of them should be read as an answer.
  it.each(['', '1', 'yes', 'TRUE', 'True', ' true', 'on'])(
    'ignores %o and keeps the default',
    (value) => {
      process.env[KEY] = value
      expect(walletRequiredToPlay()).toBe(false)
    },
  )
})
