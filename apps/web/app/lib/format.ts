/** Хост адреса для списка: путь и схема только мешают сканировать */
export function hostOf(url: string) {
  try {
    return new URL(url).host
  }
  catch {
    return url
  }
}

/** Локаль i18n (`ru_RU`) в тег BCP 47 (`ru-RU`): `Intl` не принимает подчёркивание */
export function formatDateTime(iso: string, locale: string) {
  return new Intl.DateTimeFormat(locale.replace('_', '-'), {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso))
}

const RELATIVE_STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['second', 60],
  ['minute', 60],
  ['hour', 24],
  ['day', 7],
  ['week', 4.35],
  ['month', 12],
  ['year', Number.POSITIVE_INFINITY],
]

/** «4 мин. назад»: в списках относительное время сканируется быстрее даты */
export function formatRelative(iso: string, locale: string, now = Date.now()) {
  const rtf = new Intl.RelativeTimeFormat(locale.replace('_', '-'), {
    numeric: 'auto',
    style: 'short',
  })
  let value = (new Date(iso).getTime() - now) / 1000

  if (Math.abs(value) < 45)
    return rtf.format(0, 'second')

  for (const [unit, size] of RELATIVE_STEPS) {
    if (Math.abs(value) < size)
      return rtf.format(Math.round(value), unit)

    value /= size
  }

  return rtf.format(Math.round(value), 'year')
}
