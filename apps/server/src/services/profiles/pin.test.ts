import { beforeEach, describe, expect, it, vi } from 'vitest'
import { checkPinAttempt, PinLockedError, resetPinAttempts } from './pin.ts'

describe('checkPinAttempt', () => {
  beforeEach(() => resetPinAttempts())

  it('locks parallel wrong attempts of one device after five failures', async () => {
    const verify = vi.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 5))
      return false
    })

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        checkPinAttempt('profile', 'device', verify)),
    )

    expect(verify.mock.calls.length).toBeLessThanOrEqual(5)
    expect(
      results.filter(
        r => r.status === 'rejected' && r.reason instanceof PinLockedError,
      ).length,
    ).toBeGreaterThanOrEqual(15)
    await expect(
      checkPinAttempt('profile', 'device', verify),
    ).rejects.toBeInstanceOf(PinLockedError)
  })

  it('resets failures after the right PIN', async () => {
    for (let i = 0; i < 4; i++)
      await checkPinAttempt('profile', 'device', async () => false)

    await expect(
      checkPinAttempt('profile', 'device', async () => true),
    ).resolves.toEqual({ ok: true })
    await expect(
      checkPinAttempt('profile', 'device', async () => false),
    ).resolves.toEqual({ ok: false, attemptsLeft: 4 })
  })
})
