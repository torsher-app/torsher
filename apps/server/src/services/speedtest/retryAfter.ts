// Retry-After is either nonnegative integer seconds or an HTTP-date. Keep the
// projected timestamp inside the four-digit ISO range used by clients.
const MAX_DATE_MS = 253402300799999
const HTTP_DATE
  = /^(?:[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT|[A-Z][a-z]+, \d{2}-[A-Z][a-z]{2}-\d{2} \d{2}:\d{2}:\d{2} GMT|[A-Z][a-z]{2} [A-Z][a-z]{2} [ \d]\d \d{2}:\d{2}:\d{2} \d{4})$/
const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]

function validHttpDate(text: string, date: Date) {
  const canonical = date.toUTCString()
  const day = canonical.slice(5, 7)
  const month = canonical.slice(8, 11)
  const year = canonical.slice(12, 16)
  const time = canonical.slice(17, 25)
  return [
    canonical,
    `${WEEKDAYS[date.getUTCDay()]}, ${day}-${month}-${year.slice(2)} ${time} GMT`,
    `${canonical.slice(0, 3)} ${month} ${day.startsWith('0') ? ` ${day.slice(1)}` : day} ${time} ${year}`,
  ].includes(text)
}

export function parseRetryAfter(
  value: string | null,
  now = Date.now(),
): string | undefined {
  if (value === null || !Number.isFinite(now))
    return undefined
  const text = value.trim()
  const timestamp = /^\d+$/.test(text)
    ? now + Number(text) * 1000
    : HTTP_DATE.test(text)
      ? Date.parse(text.endsWith(' GMT') ? text : `${text} GMT`)
      : Number.NaN
  if (!Number.isFinite(timestamp) || timestamp < 0 || timestamp > MAX_DATE_MS)
    return undefined
  const date = new Date(timestamp)
  if (!/^\d+$/.test(text) && !validHttpDate(text, date))
    return undefined
  return date.toISOString()
}
