import { describe, expect, it } from 'vitest'
import {
  backAction,
  bufferedSeconds,
  bufferingStep,
  byteOffset,
  clampTime,
  endsAt,
  formatClock,
  formatDuration,
  formatGigabytes,
  holdScrub,
  pressScrub,
  SCRUB_TICK_MS,
  seekStep,
} from './player.ts'

const peers = (connected: number) => ({ connected, found: connected * 3 })

describe('шаги буферизации', () => {
  it('пока движок ищет пиров — «подключаемся»', () => {
    expect(bufferingStep(null, 0)).toBe('connecting')
    expect(bufferingStep({ activity: 'idle', peers: peers(0) }, 2000)).toBe(
      'connecting',
    )
    expect(
      bufferingStep({ activity: 'downloading', peers: peers(0) }, 5000),
    ).toBe('connecting')
  })

  it('долго без пиров — честное «ждём пиров»', () => {
    expect(
      bufferingStep({ activity: 'downloading', peers: peers(0) }, 15_000),
    ).toBe('waitingPeers')
    expect(bufferingStep(null, 20_000)).toBe('waitingPeers')
  })

  it('пиры подключились — буферизация', () => {
    expect(
      bufferingStep({ activity: 'downloading', peers: peers(4) }, 1000),
    ).toBe('buffering')
    expect(
      bufferingStep({ activity: 'downloading', peers: peers(4) }, 60_000),
    ).toBe('buffering')
  })
})

describe('back в два шага', () => {
  it('сначала закрывает панель дорожек, потом прячет OSD, потом выходит', () => {
    expect(backAction({ panelOpen: true, osdVisible: true })).toBe(
      'closePanel',
    )
    expect(backAction({ panelOpen: false, osdVisible: true })).toBe('hideOsd')
    expect(backAction({ panelOpen: false, osdVisible: false })).toBe('exit')
  })
})

describe('перемотка', () => {
  it('шаг растёт с временем удержания', () => {
    expect(seekStep(0)).toBe(10)
    expect(seekStep(1500)).toBe(30)
    expect(seekStep(4000)).toBe(60)
    expect(seekStep(10_000)).toBe(120)
  })

  it('отдельные нажатия копятся от уже набранной цели', () => {
    const first = pressScrub(null, 100, 1, 0, 5400)
    const second = pressScrub(first, 999, 1, 300, 5400)

    expect(first.target).toBe(110)
    expect(second.target).toBe(120)
  })

  it('смена направления начинает отсчёт удержания заново', () => {
    const forward = pressScrub(null, 100, 1, 0, 5400)
    const back = pressScrub(forward, 100, -1, 5000, 5400)

    expect(back.target).toBe(100)
    expect(back.startedAt).toBe(5000)
  })

  it('при удержании шаг не чаще тика и ускоряется', () => {
    let scrub = pressScrub(null, 0, 1, 0, 5400)

    expect(holdScrub(scrub, SCRUB_TICK_MS - 1, 5400)).toBe(scrub)

    scrub = holdScrub(scrub, 250, 5400)
    expect(scrub.target).toBe(20)

    scrub = holdScrub(scrub, 2000, 5400)
    expect(scrub.target).toBe(50)

    scrub = holdScrub(scrub, 7000, 5400)
    expect(scrub.target).toBe(170)
  })

  it('не уходит за начало и за конец', () => {
    expect(pressScrub(null, 4, -1, 0, 5400).target).toBe(0)
    expect(pressScrub(null, 5395, 1, 0, 5400).target).toBe(5399)
    expect(clampTime(50, Number.NaN)).toBe(50)
  })
})

describe('буфер и позиция в байтах', () => {
  it('секунды буфера по среднему битрейту файла', () => {
    expect(bufferedSeconds(50 * 1024 * 1024, 1024 * 1024 * 1024, 2048)).toBe(
      100,
    )
    expect(bufferedSeconds(1000, 0, 100)).toBe(0)
    expect(bufferedSeconds(1000, 5000, Number.NaN)).toBe(0)
  })

  it('позиция чтения в байтах', () => {
    expect(byteOffset(600, 1_000_000, 6000)).toBe(100_000)
    expect(byteOffset(600, 1_000_000, Number.NaN)).toBe(0)
  })
})

describe('время', () => {
  it('длительность в часах и минутах', () => {
    expect(formatDuration(3723)).toBe('1:02:03')
    expect(formatDuration(1124)).toBe('18:44')
    expect(formatDuration(-5)).toBe('0:00')
  })

  it('«закончится в» — от текущего времени плюс остаток', () => {
    const now = new Date(2026, 9, 21, 18, 2, 30)

    expect(endsAt(now, 1124).getMinutes()).toBe(21)
    expect(formatClock(endsAt(now, 1124), 'ru_RU')).toBe('18:21')
  })
})

describe('место на диске', () => {
  it('гигабайты с одним знаком по локали', () => {
    expect(formatGigabytes(2.25 * 1024 ** 3, 'ru_RU')).toBe('2,3')
    expect(formatGigabytes(0, 'en_US')).toBe('0.0')
  })
})
