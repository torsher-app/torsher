interface DayFormatter {
  format: Intl.DateTimeFormat
  isoOrder: boolean
}

const byZone = new Map<string, DayFormatter>()
const isoDay = /^\d{4}-\d{2}-\d{2}$/
const formatProbe = Date.UTC(2000, 1, 17, 12)

export const DAY_MS = 86_400_000

function dayFromParts(format: Intl.DateTimeFormat, milliseconds: number) {
  const parts = format.formatToParts(milliseconds)
  const find = (type: string) =>
    parts.find(part => part.type === type)!.value
  return `${find('year').padStart(4, '0')}-${find('month')}-${find('day')}`
}

export function calendarDayAt(milliseconds: number, timeZone: string) {
  let cached = byZone.get(timeZone)
  if (!cached) {
    const format = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      calendar: 'iso8601',
      numberingSystem: 'latn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    // The probe has different day and month values in every zone. ICU can
    // change the locale pattern, so verify the order before using its string.
    cached = {
      format,
      isoOrder:
        format.format(formatProbe) === dayFromParts(format, formatProbe),
    }
    byZone.set(timeZone, cached)
  }
  if (cached.isoOrder) {
    const day = cached.format.format(milliseconds)
    if (isoDay.test(day))
      return day
  }
  return dayFromParts(cached.format, milliseconds)
}

export function foldForSearch(value: string) {
  return value.normalize('NFC').toLowerCase()
}

function dayStart(day: string) {
  return Date.parse(`${day}T00:00:00.000Z`)
}

/** A civil half-open range. UTC bounds are a coarse prefilter only. */
export function calendarPeriod(period: string) {
  const day
    = period.length === 4
      ? `${period}-01-01`
      : period.length === 7
        ? `${period}-01`
        : period
  const from = dayStart(day)
  const next = new Date(from)
  if (period.length === 4)
    next.setUTCFullYear(next.getUTCFullYear() + 1)
  else if (period.length === 7)
    next.setUTCMonth(next.getUTCMonth() + 1)
  else next.setUTCDate(next.getUTCDate() + 1)

  return {
    dayFrom: day,
    dayTo:
      next.getUTCFullYear() > 9999
        ? '9999-12-32'
        : next.toISOString().slice(0, 10),
    instantFrom: from - DAY_MS,
    instantTo: next.getTime() + DAY_MS,
  }
}
