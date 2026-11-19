export function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

// The API sends diary-zone calendar days. UTC keeps arithmetic independent of
// the viewer's timezone, even when it has skipped an entire local day.
function civilDate(day: string) {
  return new Date(`${day}T00:00:00Z`)
}

function civilDay(date: Date) {
  return date.toISOString().split('T')[0]!
}

export function offsetDay(day: string, offset: number) {
  const date = civilDate(day)
  date.setUTCDate(date.getUTCDate() + offset)
  return civilDay(date)
}

export function offsetMonthOrYear(
  day: string,
  part: 'month' | 'year',
  offset: number,
) {
  const date = civilDate(day)
  const number = date.getUTCDate()
  date.setUTCDate(1)
  if (part === 'year')
    date.setUTCFullYear(date.getUTCFullYear() + offset)
  else date.setUTCMonth(date.getUTCMonth() + offset)
  date.setUTCMonth(date.getUTCMonth() + 1, 0)
  date.setUTCDate(Math.min(number, date.getUTCDate()))
  return civilDay(date)
}

export function daysSinceMonday(day: string) {
  return (civilDate(day).getUTCDay() + 6) % 7
}

export function formatMineDate(
  day: string,
  locale: string,
  options: Intl.DateTimeFormatOptions,
) {
  const language = locale.replace('_', '-')

  try {
    if (Intl.DateTimeFormat.supportedLocalesOf([language]).length) {
      return new Intl.DateTimeFormat(language, {
        ...options,
        timeZone: 'UTC',
      }).format(civilDate(day))
    }
  }
  catch {
    /* Fall back to the numeric date. */
  }

  return `${day.slice(8, 10)}.${day.slice(5, 7)}`
}

export function mineDayLabel(
  day: string,
  locale: string,
  t: (key: string) => string,
  today: string,
  short = false,
) {
  const relative
    = day === today
      ? 'today'
      : day === offsetDay(today, -1)
        ? 'yesterday'
        : undefined
  const date = formatMineDate(day, locale, {
    ...(short ? {} : { weekday: 'short' as const }),
    day: 'numeric',
    month: short ? 'short' : 'long',
  })

  return relative
    ? `${t(`mine.schedule.${relative}`)}${short ? '' : `, ${date}`}`
    : date
}

export function monthCalendar(
  month: string,
  counts: Record<string, number>,
  today: string,
) {
  const first = `${month}-01`
  const previousMonday = -daysSinceMonday(first)

  return Array.from({ length: 42 }, (_, index) => {
    const day = offsetDay(first, previousMonday + index)
    return {
      day,
      number: Number(day.slice(-2)),
      count: counts[day] ?? 0,
      current: day.startsWith(month),
      future: day > today,
    }
  })
}

export function diaryClock(instant: string, timeZone: string, locale: string) {
  try {
    return new Intl.DateTimeFormat(locale.replace('_', '-'), {
      timeZone,
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(instant))
  }
  catch {
    // A television without IANA timezone data must not show a different clock.
    return undefined
  }
}

export function validMineDay(value: string, today: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value > today)
    return false
  const date = civilDate(value)
  return Number.isFinite(date.getTime()) && civilDay(date) === value
}

export function countryLabel(country: string, locale: string) {
  try {
    return typeof Intl.DisplayNames === 'function'
      ? (new Intl.DisplayNames(locale.replace('_', '-'), { type: 'region' }).of(
          country,
        ) ?? country)
      : country
  }
  catch {
    return country
  }
}
