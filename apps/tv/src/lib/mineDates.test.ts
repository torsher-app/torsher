import { describe, expect, it, vi } from 'vitest'
import {
  demoDate,
  MINE_DIARY_ENTRIES,
  MINE_TODAY,
  MINE_UNDATED_ENTRY,
} from '../demo/minePreviewData.ts'
import {
  daysSinceMonday,
  diaryClock,
  formatMineDate,
  mineDayLabel,
  monthCalendar,
  offsetDay,
  offsetMonthOrYear,
  validMineDay,
} from './mineDates.ts'

describe('mine demo dates', () => {
  it.each(['2026-02', '2028-02', '2026-03', '2026-11', '2027-01'])(
    'keeps a Monday-first 42-cell calendar for %s',
    (month) => {
      const days = monthCalendar(month, {}, '2027-01-01')
      const expected = new Date(
        Number(month.slice(0, 4)),
        Number(month.slice(5, 7)),
        0,
      ).getDate()

      expect(days).toHaveLength(42)
      expect(new Date(`${days[0]!.day}T12:00:00`).getDay()).toBe(1)
      expect(days.filter(day => day.current)).toHaveLength(expected)
      expect(new Set(days.map(day => day.day)).size).toBe(42)
    },
  )

  it('shifts through year and month boundaries without inventing future history', () => {
    expect(offsetDay('2027-01-01', -1)).toBe('2026-12-31')
    expect(offsetDay('2028-03-01', -1)).toBe('2028-02-29')
    expect(
      MINE_DIARY_ENTRIES.every(entry => entry.day && entry.day <= MINE_TODAY),
    ).toBe(true)
    expect(
      new Set(MINE_DIARY_ENTRIES.map(entry => entry.day!.slice(0, 7))).size,
    ).toBeGreaterThanOrEqual(2)
    expect(MINE_UNDATED_ENTRY.day).toBeNull()
  })

  it('keeps all daily events, including rewatches, in calendar counts', () => {
    const counts: Record<string, number> = {}

    for (const entry of MINE_DIARY_ENTRIES)
      counts[entry.day!] = (counts[entry.day!] ?? 0) + 1

    const month = MINE_TODAY.slice(0, 7)
    const monthly = MINE_DIARY_ENTRIES.filter(entry =>
      entry.day!.startsWith(month),
    )
    const total = monthCalendar(month, counts, MINE_TODAY)
      .filter(day => day.current)
      .reduce((sum, day) => sum + day.count, 0)

    expect(total).toBe(monthly.length)
    expect(counts[demoDate(-2)]).toBe(10)
    expect(counts[demoDate(-4)]).toBe(12)
    expect(MINE_DIARY_ENTRIES.length).toBeGreaterThan(
      new Set(MINE_DIARY_ENTRIES.map(entry => entry.card.id)).size,
    )
  })

  it('falls back for an unsupported locale instead of breaking the screen', () => {
    expect(
      formatMineDate('2026-11-18', 'not_a_locale', { day: 'numeric' }),
    ).toBe('18.11')
  })
})

it('uses the diary zone for an instant and rejects impossible or future local days', () => {
  expect(
    diaryClock('2026-11-19T00:30:00Z', 'America/Los_Angeles', 'en_US'),
  ).toBe('4:30 PM')
  expect(validMineDay('2026-02-29', '2026-11-19')).toBe(false)
  expect(validMineDay('2026-11-20', '2026-11-19')).toBe(false)
  expect(validMineDay('2026-11-19', '2026-11-19')).toBe(true)
})

it('keeps the diary civil day even when the device timezone skipped it', () => {
  vi.stubEnv('TZ', 'Pacific/Apia')
  try {
    expect(new Date('2011-12-30T12:00:00').getDate()).toBe(31)
    expect(offsetDay('2011-12-29', 1)).toBe('2011-12-30')
    expect(offsetDay('2011-12-30', 1)).toBe('2011-12-31')
    expect(daysSinceMonday('2011-12-30')).toBe(4)
    const calendar = monthCalendar(
      '2011-12',
      { '2011-12-30': 2 },
      '2011-12-31',
    )
    expect(new Set(calendar.map(item => item.day)).size).toBe(42)
    expect(calendar).toContainEqual({
      day: '2011-12-30',
      number: 30,
      count: 2,
      current: true,
      future: false,
    })
    expect(
      mineDayLabel('2011-12-30', 'en_US', key => key, '2011-12-31', true),
    ).toBe('mine.schedule.yesterday')
    expect(
      formatMineDate('2011-12-30', 'en_US', { day: 'numeric', month: 'short' }),
    ).toBe('Dec 30')
    expect(
      formatMineDate('2011-12-30', 'not_a_locale', { day: 'numeric' }),
    ).toBe('30.12')
  }
  finally {
    vi.unstubAllEnvs()
  }
})

it('clamps the diary date when shifting into a shorter month or year', () => {
  expect(offsetMonthOrYear('2027-01-31', 'month', 1)).toBe('2027-02-28')
  expect(offsetMonthOrYear('2028-01-31', 'month', 1)).toBe('2028-02-29')
  expect(offsetMonthOrYear('2028-02-29', 'year', 1)).toBe('2029-02-28')
  expect(offsetMonthOrYear('2027-01-01', 'month', -1)).toBe('2026-12-01')
  expect(offsetMonthOrYear('2027-01-01', 'year', -1)).toBe('2026-01-01')
})
