import { describe, expect, it } from 'vitest'
import { focusedFile, progressOf } from './files.ts'

function file(episode: number, position = 0, watched = false) {
  return { season: 1, episode, position, watched }
}

describe('focusedFile', () => {
  it('серия из истории сильнее прогресса', () => {
    expect(
      focusedFile([file(1, 10), file(2), file(3)], { season: 1, episode: 3 }),
    ).toBe(2)
  })

  it('сезон из фильтра без прогресса — его первая серия', () => {
    const list = [
      file(1),
      file(2),
      { season: 2, episode: 1, position: 0, watched: false },
    ]

    expect(focusedFile(list, { season: 2 })).toBe(2)
  })

  it('сезон из фильтра с прогрессом — продолжить в этом сезоне', () => {
    const s2 = (episode: number, position = 0, watched = false) => ({
      season: 2,
      episode,
      position,
      watched,
    })
    const list = [
      file(1, 100, true),
      file(2, 40),
      s2(1, 100, true),
      s2(2),
      s2(3),
    ]

    expect(focusedFile(list, { season: 2 })).toBe(3)
    // Прогресс другого сезона не уводит из выбранного
    expect(focusedFile([file(1, 40), s2(1), s2(2)], { season: 2 })).toBe(1)
  })

  it('последняя начатая, а досмотренная — следующая за ней', () => {
    expect(focusedFile([file(1, 100, true), file(2, 30), file(3)])).toBe(1)
    expect(focusedFile([file(1, 100, true), file(2, 100, true), file(3)])).toBe(
      2,
    )
    expect(focusedFile([file(1), file(2)])).toBe(0)
  })

  it('досмотрена последняя серия — остаёмся на ней', () => {
    expect(focusedFile([file(1, 100, true)])).toBe(0)
  })
})

describe('progressOf', () => {
  it('доля, досмотренная — целиком, без длительности — ноль', () => {
    expect(progressOf({ position: 30, duration: 60, watched: false })).toBe(
      0.5,
    )
    expect(progressOf({ position: 1, duration: 1, watched: true })).toBe(1)
    expect(progressOf({ position: 30, duration: null, watched: false })).toBe(
      0,
    )
  })
})
