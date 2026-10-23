import type { FileCard } from '@torsher/api-client'

/**
 * Дата съёмки хранится «как на часах камеры» в UTC-компонентах: показываем
 * её в UTC, иначе видео съехало бы на день в зоне ТВ
 */
function format(
  iso: string,
  locale: string,
  options: Intl.DateTimeFormatOptions,
) {
  const date = new Date(iso)

  if (Number.isNaN(date.getTime()))
    return ''

  try {
    if (Intl.DateTimeFormat.supportedLocalesOf([locale]).length > 0) {
      return new Intl.DateTimeFormat(locale, {
        ...options,
        timeZone: 'UTC',
      }).format(date)
    }
  }
  catch {
    // Ниже — формат без Intl
  }

  const pad = (value: number) => String(value).padStart(2, '0')

  return options.day
    ? `${pad(date.getUTCDate())}.${pad(date.getUTCMonth() + 1)}.${date.getUTCFullYear()}`
    : `${pad(date.getUTCMonth() + 1)}.${date.getUTCFullYear()}`
}

/** «14 июля 2019 г.» */
export function formatCaptured(iso: string, locale: string) {
  return format(iso, locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

/** «Июль 2023»: заголовок месяца в виде «По датам» */
export function formatMonth(iso: string, locale: string) {
  const text = format(iso, locale, { month: 'long', year: 'numeric' })
    // «июль 2023 г.» → «июль 2023»: заголовку год без сокращения не нужен
    .replace(/\s*г\.$/, '')

  return text.charAt(0).toUpperCase() + text.slice(1)
}

export interface MonthGroup {
  key: string
  // Дата первого видео месяца — для подписи
  sample: string | null
  items: FileCard[]
}

/** Видео по месяцам съёмки, в порядке списка (новые сверху); без даты — в конце */
export function groupByMonth(items: FileCard[]): MonthGroup[] {
  const groups: MonthGroup[] = []
  const byKey = new Map<string, MonthGroup>()

  for (const item of items) {
    const key = item.capturedAt ? item.capturedAt.slice(0, 7) : 'none'
    let group = byKey.get(key)

    if (!group) {
      group = { key, sample: item.capturedAt, items: [] }
      byKey.set(key, group)
      groups.push(group)
    }

    group.items.push(item)
  }

  return groups.sort(
    (a, b) => Number(a.key === 'none') - Number(b.key === 'none'),
  )
}

/** Название альбома — последняя папка пути; `''` — видео в корне */
export function albumName(album: string) {
  return album.slice(album.lastIndexOf('/') + 1)
}

/** Строка сетки: заголовок месяца или ряд карточек */
export type GridRow<T>
  = | { kind: 'header', key: string, label: string }
    | { kind: 'cards', key: string, items: T[] }

/**
 * Сетка строками: у групп с заголовком — строка заголовка, затем карточки по
 * `columns` в строке. Строки — единица окна: заголовки и карточки разной высоты
 */
export function gridRows<T>(
  groups: Array<{ key: string, label?: string, items: T[] }>,
  columns: number,
): GridRow<T>[] {
  const rows: GridRow<T>[] = []

  for (const group of groups) {
    if (group.label !== undefined)
      rows.push({ kind: 'header', key: `h:${group.key}`, label: group.label })

    for (let start = 0; start < group.items.length; start += columns) {
      rows.push({
        kind: 'cards',
        key: `c:${group.key}:${start}`,
        items: group.items.slice(start, start + columns),
      })
    }
  }

  return rows
}

/**
 * Окно строк вокруг строки с фокусом: в DOM — только они, остальное место
 * держат отступы сверху и снизу по высотам строк (заголовок и карточки
 * меряются по DOM)
 */
export function rowWindow(
  kinds: Array<'header' | 'cards'>,
  focused: number,
  before: number,
  after: number,
  heights: { header: number, cards: number },
) {
  const from = Math.max(0, Math.min(focused, kinds.length - 1) - before)
  const to = Math.min(kinds.length, Math.max(focused, 0) + after + 1)
  const sum = (start: number, end: number) => {
    let total = 0

    for (let index = start; index < end; index++)
      total += heights[kinds[index]!]

    return total
  }

  return { from, to, top: sum(0, from), bottom: sum(to, kinds.length) }
}
