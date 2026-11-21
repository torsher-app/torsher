import { describe, expect, it } from 'vitest'
import { calendarDayAt, calendarPeriod } from './calendar.ts'

describe('calendar day', () => {
  it.each([
    ['UTC', '1969-12-31T23:59:59Z', '1969-12-31'],
    ['UTC', '0001-01-01T12:00:00Z', '0001-01-01'],
    ['UTC', '0999-08-17T12:00:00Z', '0999-08-17'],
    ['America/New_York', '2025-11-02T05:30:00Z', '2025-11-02'],
    ['America/New_York', '2025-11-02T06:30:00Z', '2025-11-02'],
    ['Europe/Moscow', '1969-12-31T22:00:00Z', '1970-01-01'],
    ['America/St_Johns', '1987-10-25T02:29:59Z', '1987-10-24'],
    ['America/St_Johns', '1987-10-25T02:30:00Z', '1987-10-25'],
    ['America/St_Johns', '1987-10-25T02:31:00Z', '1987-10-24'],
    ['America/St_Johns', '1987-10-25T03:30:00Z', '1987-10-25'],
    ['Pacific/Apia', '2011-12-30T09:59:59Z', '2011-12-29'],
    ['Pacific/Apia', '2011-12-30T10:00:00Z', '2011-12-31'],
  ])('matches calendar parts in %s at %s', (timeZone, instant, expected) => {
    const milliseconds = Date.parse(instant)
    const format = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      calendar: 'iso8601',
      numberingSystem: 'latn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    const parts = Object.fromEntries(
      format.formatToParts(milliseconds).map(part => [part.type, part.value]),
    )
    const previous = `${parts.year?.padStart(4, '0')}-${parts.month}-${parts.day}`
    expect(previous).toBe(expected)
    expect(calendarDayAt(milliseconds, timeZone)).toBe(previous)
  })

  it('preserves a literal calendar day when the zone skipped that date', () => {
    expect(calendarPeriod('2011-12-30')).toMatchObject({
      dayFrom: '2011-12-30',
      dayTo: '2011-12-31',
    })
  })
})
