import { describe, expect, it } from 'vitest'
import {
  formatAirDate,
  formatYears,
  isUpcoming,
  seasonAired,
} from './titleInfo.ts'

describe('formatYears', () => {
  it('один год, диапазон и идущий сериал', () => {
    expect(formatYears({ year: 2008 }, 'н. в.')).toBe('2008')
    expect(formatYears({ year: 2019, endYear: 2022 }, 'н. в.')).toBe(
      '2019–2022',
    )
    expect(formatYears({ year: 2021, endYear: 2021 }, 'н. в.')).toBe('2021')
    expect(formatYears({ year: 2023, ongoing: true }, 'н. в.')).toBe(
      '2023 — н. в.',
    )
    expect(formatYears({}, 'н. в.')).toBe('')
  })
})

describe('seasonAired', () => {
  const season = { number: 1, name: '1', episodeCount: 8 }

  it('вышедший целиком сезон — без подписи «из»', () => {
    expect(seasonAired({ ...season, airedEpisodeCount: 8 })).toBeUndefined()
  })

  it('идущий сезон — вышло из всего', () => {
    expect(seasonAired({ ...season, airedEpisodeCount: 4 })).toEqual({
      aired: 4,
      total: 8,
    })
  })
})

describe('isUpcoming', () => {
  const now = new Date(2026, 9, 20, 23, 30)

  it('сегодняшняя серия уже вышла, завтрашняя — нет', () => {
    expect(isUpcoming('2026-10-20', now)).toBe(false)
    expect(isUpcoming('2026-10-21', now)).toBe(true)
    expect(isUpcoming(undefined, now)).toBe(false)
  })
})

describe('formatAirDate', () => {
  it('пишет день и месяц на языке интерфейса', () => {
    expect(formatAirDate('2026-10-24', 'ru-RU')).toMatch(/24/)
    expect(formatAirDate('2026-10-24', 'ru-RU')).toMatch(/окт/)
  })

  it('без данных локали — числовая дата', () => {
    expect(formatAirDate('2026-03-05', 'xx-XX')).toBe('05.03')
  })
})
