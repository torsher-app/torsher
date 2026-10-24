import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cornerOf,
  DEFAULT_SCREENSAVER_MINUTES,
  idleDue,
  loadScreensaverMinutes,
  saveScreensaverMinutes,
  screensaverRests,
  shuffled,
} from './screensaver.ts'

const MINUTE = 60_000

describe('idleDue', () => {
  it('включает после заданного простоя', () => {
    expect(idleDue(0, 5 * MINUTE - 1, 5)).toBe(false)
    expect(idleDue(0, 5 * MINUTE, 5)).toBe(true)
  })

  it('0 минут — заставка выключена', () => {
    expect(idleDue(0, 600 * MINUTE, 0)).toBe(false)
  })
})

describe('screensaverRests', () => {
  it('гаснет через час после включения', () => {
    const since = 5 * MINUTE

    expect(screensaverRests(since, since + 60 * MINUTE - 1)).toBe(false)
    expect(screensaverRests(since, since + 60 * MINUTE)).toBe(true)
    expect(screensaverRests(since, since + 180 * MINUTE)).toBe(true)
  })
})

describe('shuffled', () => {
  it('тот же набор, исходный массив не меняется', () => {
    const items = [1, 2, 3, 4, 5]
    const result = shuffled(items, () => 0.3)

    expect(result.slice().sort()).toEqual(items)
    expect(items).toEqual([1, 2, 3, 4, 5])
  })

  it('последний показанный кадр не идёт первым', () => {
    // random() = 0.99 оставляет порядок как есть: первым был бы 1
    expect(shuffled([1, 2, 3], () => 0.99, 1)[0]).not.toBe(1)
  })

  it('пустой и одиночный набор', () => {
    expect(shuffled([])).toEqual([])
    expect(shuffled([7], Math.random, 7)).toEqual([7])
  })
})

describe('cornerOf', () => {
  it('обходит четыре угла по кругу', () => {
    expect([0, 1, 2, 3, 4].map(cornerOf)).toEqual([
      'bottomLeft',
      'topRight',
      'bottomRight',
      'topLeft',
      'bottomLeft',
    ])
  })
})

describe('время заставки на устройстве', () => {
  const store = new Map<string, string>()

  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    },
  })

  afterEach(() => store.clear())

  it('без записи и с чужим значением — по умолчанию', () => {
    expect(loadScreensaverMinutes()).toBe(DEFAULT_SCREENSAVER_MINUTES)

    store.set('torsher.screensaver', '7')
    expect(loadScreensaverMinutes()).toBe(DEFAULT_SCREENSAVER_MINUTES)
  })

  it('запоминает выбор, включая «выключена»', () => {
    saveScreensaverMinutes(0)
    expect(loadScreensaverMinutes()).toBe(0)

    saveScreensaverMinutes(15)
    expect(loadScreensaverMinutes()).toBe(15)
  })
})
