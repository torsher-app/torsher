import { describe, expect, it } from 'vitest'
import { createRateLimiter } from './rateLimit.ts'

describe('createRateLimiter', () => {
  it('allows hits up to the limit within the window', () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000 })

    expect(limiter.hit('a', 0)).toBe(true)
    expect(limiter.hit('a', 10)).toBe(true)
    expect(limiter.hit('a', 20)).toBe(false)
    expect(limiter.hit('a', 1000)).toBe(true)
  })

  it('reports the limit without counting an attempt', () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000 })

    expect(limiter.isLimited('a', 0)).toBe(false)
    limiter.hit('a', 0)
    expect(limiter.isLimited('a', 10)).toBe(false)
    limiter.hit('a', 10)
    expect(limiter.isLimited('a', 20)).toBe(true)
    expect(limiter.isLimited('a', 30)).toBe(true)
    expect(limiter.isLimited('b', 30)).toBe(false)
    expect(limiter.isLimited('a', 1000)).toBe(false)
  })

  it('returns whole seconds until the window ends', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 })

    expect(limiter.retryAfter('a', 0)).toBe(0)
    limiter.hit('a', 0)
    expect(limiter.retryAfter('a', 0)).toBe(60)
    expect(limiter.retryAfter('a', 59_001)).toBe(1)
    expect(limiter.retryAfter('a', 60_000)).toBe(0)
  })

  it('forgets a key after reset', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 })

    limiter.hit('a', 0)
    limiter.reset('a')
    expect(limiter.isLimited('a', 10)).toBe(false)
  })
})
