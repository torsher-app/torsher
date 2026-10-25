import type {
  FollowCursor,
  ScheduleItem,
  TitleFollow,
  TitleFollowResponse,
} from '@torsher/api-client'

export type CursorPreset = 'new' | 'season' | 'beginning'
export type CursorOptions = NonNullable<TitleFollowResponse['options']>

export const CURSOR_PRESETS: CursorPreset[] = ['new', 'season', 'beginning']

/** «Ждать лучшее»: не ждать, 12 ч, сутки, 3 дня */
export const WAIT_HOURS = [0, 12, 24, 72]

export const QUALITY_PRESETS = ['best', 'uhd', 'compact'] as const

/** Лестницы пресетов, как у решателя на сервере: первое — верхняя ступень */
export const QUALITY_LADDERS: Record<
  (typeof QUALITY_PRESETS)[number],
  string[]
> = {
  best: ['1080p', '720p', 'SD'],
  uhd: ['2160p', '1080p', '720p'],
  compact: ['720p', 'SD'],
}

function sameCursor(a: FollowCursor, b: FollowCursor) {
  return a.season === b.season && a.episode === b.episode
}

/**
 * Каким пресетом стоит курсор. Пресеты могут совпадать (сезон только
 * начался) — берётся первый по порядку; курсор из панели — `undefined`.
 */
export function cursorPreset(
  start: FollowCursor,
  options: CursorOptions | null,
): CursorPreset | undefined {
  return options
    ? CURSOR_PRESETS.find(preset => sameCursor(start, options[preset]))
    : undefined
}

/** Варианты окна: набор витрины и значение из панели, если оно другое */
export function waitChoices(current: number) {
  return WAIT_HOURS.includes(current)
    ? WAIT_HOURS
    : [...WAIT_HOURS, current].sort((a, b) => a - b)
}

/** Профиль следит: подписан, и слежение идёт или стоит на паузе */
export function isFollowed(follow: TitleFollow | null | undefined) {
  return (
    !!follow
    && follow.subscribed
    && (follow.state === 'active' || follow.state === 'paused')
  )
}

export type FollowStatus
  = | { kind: 'paused' }
    | { kind: 'noSpace', count: number }
    | { kind: 'waiting', waiting: NonNullable<TitleFollow['waiting']> }
    | { kind: 'downloading', count: number }
    | { kind: 'missing', count: number }
    | { kind: 'searching', count: number }
    | { kind: 'next', code: string, airDate: string }

/**
 * Главное в статус-строке карточки, по важности для зрителя: пауза, нет места,
 * ждём лучшее, качается, не нашли, ищем, следующая серия с датой
 */
export function followStatus(follow: TitleFollow): FollowStatus | undefined {
  const { counts } = follow

  if (follow.state === 'paused')
    return { kind: 'paused' }

  if (counts.noSpace)
    return { kind: 'noSpace', count: counts.noSpace }

  if (follow.waiting)
    return { kind: 'waiting', waiting: follow.waiting }

  if (counts.downloading)
    return { kind: 'downloading', count: counts.downloading }

  if (counts.missing)
    return { kind: 'missing', count: counts.missing }

  if (counts.searching)
    return { kind: 'searching', count: counts.searching }

  const next = follow.next

  return next?.airDate
    ? {
        kind: 'next',
        code: `S${next.season}E${next.episode}`,
        airDate: next.airDate,
      }
    : undefined
}

export type FollowNote
  = { kind: 'bestQuality', quality: string } | { kind: 'pinned', studio: string }

/** Заметка после главного: опущенный cutoff важнее закреплённой студии */
export function followNote(follow: TitleFollow): FollowNote | undefined {
  if (follow.quality.lowered)
    return { kind: 'bestQuality', quality: follow.quality.value }

  if (follow.voice?.pinned && follow.voice.studio)
    return { kind: 'pinned', studio: follow.voice.studio }

  return undefined
}

/** Подпись ступени: 2160p зритель знает как 4K */
export function qualityName(value: string) {
  return value === '2160p' ? '4K' : value
}

/** Списки «Расписания»: ближайшие и вышедшие за две недели */
export type ScheduleTab = 'upcoming' | 'recent'

export interface ScheduleDay {
  date: string
  items: ScheduleItem[]
}

/** Серии подряд по дням: порядок сервера сохраняется */
export function scheduleDays(items: ScheduleItem[]): ScheduleDay[] {
  const days: ScheduleDay[] = []

  for (const item of items) {
    const last = days[days.length - 1]

    if (last?.date === item.airDate)
      last.items.push(item)
    else days.push({ date: item.airDate, items: [item] })
  }

  return days
}

function localDay(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${date.getFullYear()}-${month}-${day}`
}

function shiftDays(now: Date, days: number) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + days)
}

/** «Сегодня», «Завтра», «Вчера» — словом; остальные дни — датой */
export function relativeDay(
  date: string,
  now = new Date(),
): 'today' | 'tomorrow' | 'yesterday' | undefined {
  if (date === localDay(now))
    return 'today'

  if (date === localDay(shiftDays(now, 1)))
    return 'tomorrow'

  if (date === localDay(shiftDays(now, -1)))
    return 'yesterday'

  return undefined
}

/** День окна ожидания: сегодня — только время, завтра — словом, дальше — датой */
export function untilDay(iso: string, now = new Date()) {
  const until = new Date(iso)
  const day = relativeDay(localDay(until), now)

  return day === 'today' || day === 'tomorrow' ? day : localDay(until)
}
