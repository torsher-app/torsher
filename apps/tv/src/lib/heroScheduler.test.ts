import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHeroScheduler, HERO_DELAY_MS } from './heroScheduler.ts'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createHeroScheduler', () => {
  it('под пультом меняет hero через 120 мс', () => {
    const apply = vi.fn()
    const hero = createHeroScheduler(apply)

    hero.schedule('a', 'nav')
    vi.advanceTimersByTime(HERO_DELAY_MS.nav - 1)
    expect(apply).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(apply).toHaveBeenCalledWith('a')
  })

  it('при быстрой прокрутке применяет только последнюю карточку', () => {
    const apply = vi.fn()
    const hero = createHeroScheduler(apply)

    hero.schedule('a', 'nav')
    vi.advanceTimersByTime(60)
    hero.schedule('b', 'nav')
    vi.advanceTimersByTime(60)
    hero.schedule('c', 'nav')
    vi.advanceTimersByTime(HERO_DELAY_MS.nav)

    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenCalledWith('c')
  })

  it('под указкой ждёт дольше', () => {
    const apply = vi.fn()
    const hero = createHeroScheduler(apply)

    hero.schedule('a', 'pointer')
    vi.advanceTimersByTime(HERO_DELAY_MS.nav)
    expect(apply).not.toHaveBeenCalled()

    vi.advanceTimersByTime(HERO_DELAY_MS.pointer - HERO_DELAY_MS.nav)
    expect(apply).toHaveBeenCalledWith('a')
  })

  it('cancel отменяет ожидающую смену', () => {
    const apply = vi.fn()
    const hero = createHeroScheduler(apply)

    hero.schedule('a', 'nav')
    hero.cancel()
    vi.runAllTimers()

    expect(apply).not.toHaveBeenCalled()
  })
})
