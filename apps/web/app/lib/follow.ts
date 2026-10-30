import type { FollowDetails, FollowSummary } from '@torsher/api-client'
import type { Component } from 'vue'
import type { StatusTone } from '~/lib/indexerStatus'
import {
  BanIcon,
  CircleArrowUpIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleHelpIcon,
  CircleIcon,
  CirclePlayIcon,
  CircleXIcon,
  ClockIcon,
  DownloadIcon,
  HardDriveIcon,
  LibraryIcon,
  SearchIcon,
  SparklesIcon,
  TriangleAlertIcon,
} from '@lucide/vue'

export type FollowGroup = 'attention' | 'waiting' | 'done' | 'stopped'

export const FOLLOW_GROUPS: FollowGroup[] = [
  'attention',
  'waiting',
  'done',
  'stopped',
]

/**
 * Группа слежения в списке: проблемы первыми, остановленные последними. «Ждём
 * серию» — что-то нужно, качается или анонсировано; иначе «Всё готово»:
 * скачано или, в режиме «Только уведомлять», выбрано.
 */
export function followGroupOf(follow: FollowSummary): FollowGroup {
  if (follow.state === 'paused' || follow.state === 'stopped')
    return 'stopped'

  if (follow.counts.noSpace || follow.counts.missing || follow.unsure)
    return 'attention'

  if (follow.state === 'done')
    return 'done'

  // Без серий после курсора сериал ждёт новый сезон, а не «всё скачано»
  return (follow.counts.inLibrary || follow.counts.ready)
    && !follow.wanted
    && !follow.counts.downloading
    && !follow.counts.upcoming
    && !follow.next
    ? 'done'
    : 'waiting'
}

export type FollowStatus
  = | 'paused'
    | 'stopped'
    | 'noSpace'
    | 'missing'
    | 'unsure'
    | 'downloading'
    | 'waiting'
    | 'searching'
    | 'next'
    | 'done'

export interface FollowStatusView {
  status: FollowStatus
  tone: StatusTone
  icon: Component
  /** Сколько серий в этом состоянии: для текста */
  count: number
  /** Первая серия в этом состоянии: текст называет её кодом */
  first?: { season: number, episode: number }
}

const STATUS_VIEW: Record<
  FollowStatus,
  Pick<FollowStatusView, 'tone' | 'icon'>
> = {
  paused: { tone: 'muted', icon: CircleDashedIcon },
  stopped: { tone: 'muted', icon: CircleDashedIcon },
  noSpace: { tone: 'destructive', icon: HardDriveIcon },
  missing: { tone: 'warning', icon: CircleXIcon },
  unsure: { tone: 'warning', icon: CircleHelpIcon },
  downloading: { tone: 'info', icon: DownloadIcon },
  waiting: { tone: 'muted', icon: ClockIcon },
  searching: { tone: 'muted', icon: SearchIcon },
  next: { tone: 'muted', icon: CircleIcon },
  done: { tone: 'success', icon: CircleCheckIcon },
}

/** Одно состояние слежения для строки: самое важное из серий */
export function followStatusOf(follow: FollowSummary): FollowStatusView {
  const { counts, first } = follow
  const pick = (
    status: FollowStatus,
    count = 0,
    episode?: FollowStatusView['first'],
  ) => ({
    status,
    count,
    first: episode,
    ...STATUS_VIEW[status],
  })

  if (follow.state === 'paused')
    return pick('paused')

  if (follow.state === 'stopped')
    return pick('stopped')

  if (counts.noSpace)
    return pick('noSpace', counts.noSpace, first.noSpace)

  if (counts.missing)
    return pick('missing', counts.missing, first.missing)

  if (follow.unsure)
    return pick('unsure', follow.unsure)

  if (counts.downloading)
    return pick('downloading', counts.downloading, first.downloading)

  if (counts.waiting)
    return pick('waiting', counts.waiting)

  if (counts.searching)
    return pick('searching', counts.searching, first.searching)

  return (counts.inLibrary || counts.ready) && !follow.next && !counts.upcoming
    ? pick('done')
    : pick('next')
}

/**
 * Ключ текста состояния, кроме ожидания и следующей серии: у сериала с первой
 * серией одна — строкой с кодом, несколько — `*Many` с числом (в русском 21
 * серия иначе взяла бы форму одной)
 */
export function followStatusKey(
  follow: Pick<FollowSummary, 'kind' | 'mode'>,
  view: Pick<FollowStatusView, 'status' | 'count' | 'first'>,
) {
  if (follow.kind === 'movie') {
    return `panel.follow.status.movie.${statusName(follow, view)}`
  }

  if (view.first) {
    return `panel.follow.status.series.${view.status}${view.count === 1 ? '' : 'Many'}`
  }

  return `panel.follow.status.series.${statusName(follow, view)}`
}

// В режиме «Только уведомлять» всё вышедшее не скачано, а готово
function statusName(
  follow: Pick<FollowSummary, 'mode'>,
  view: Pick<FollowStatusView, 'status'>,
) {
  return view.status === 'done' && follow.mode === 'notify'
    ? 'doneNotify'
    : view.status
}

/** «S2E1–E3, E5»: подряд идущие серии — диапазоном; у фильма (сезон 0) — пусто */
export function episodesLabel(season: number | null, episodes: number[]) {
  if (!season)
    return ''

  const sorted = [...new Set(episodes)].sort((a, b) => a - b)
  const parts: string[] = []
  let start = sorted[0]
  let prev = start

  for (const episode of [...sorted.slice(1), Number.NaN]) {
    if (episode === prev! + 1) {
      prev = episode
      continue
    }

    if (start !== undefined)
      parts.push(start === prev ? `E${start}` : `E${start}–E${prev}`)

    start = episode
    prev = episode
  }

  return parts.length ? `S${season}${parts.join(', ')}` : `S${season}`
}

/** Студия → тип озвучки или язык → качество: чего ждёт отложенный кандидат */
export interface WaitTarget {
  studio?: string
  voiceType?: string
  language?: string
  quality?: string
}

/** Параметры отказа или события могут прийти любого типа: берём только строки */
export function waitTargetOf(params: Record<string, unknown> | undefined) {
  const pick = (key: string) =>
    typeof params?.[key] === 'string' ? (params[key] as string) : undefined

  return {
    studio: pick('studio'),
    voiceType: pick('voiceType'),
    language: pick('language'),
    quality: pick('quality'),
  }
}

/** Время окна: сегодня — только часы, иначе с датой */
export function formatUntil(iso: string, locale: string, now = Date.now()) {
  const date = new Date(iso)
  const tag = locale.replace('_', '-')
  const sameDay = date.toDateString() === new Date(now).toDateString()

  return new Intl.DateTimeFormat(
    tag,
    sameDay
      ? { timeStyle: 'short' }
      : {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          hour: 'numeric',
          minute: '2-digit',
        },
  ).format(date)
}

/** Дата выхода серии `YYYY-MM-DD` без сдвига в UTC */
export function formatAirDate(airDate: string, locale: string) {
  const [year, month, day] = airDate.split('-').map(Number) as [
    number,
    number,
    number,
  ]

  return new Intl.DateTimeFormat(locale.replace('_', '-'), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(year, month - 1, day))
}

/** Бейдж состояния в карточке — того же тона, что иконка в строке */
export const toneBadge = {
  success: 'success',
  warning: 'warning',
  info: 'info',
  destructive: 'destructive',
  muted: 'outline',
} as const satisfies Record<StatusTone, string>

export const QUALITY_PRESETS = ['best', 'uhd', 'compact'] as const

/** «Новая серия»: скачать в библиотеку или только уведомить */
export const FOLLOW_MODES = ['download', 'notify'] as const

export type FollowAudio = FollowSummary['audioEffective']

/**
 * Языки озвучки, как у сервера: оригинал и языки дорожек, которые узнаёт
 * парсер названий
 */
export const FOLLOW_AUDIOS = [
  'original',
  'ru',
  'en',
  'uk',
  'ja',
  'de',
  'fr',
  'es',
  'it',
  'ko',
  'zh',
] as const satisfies readonly FollowAudio[]

/**
 * Озвучка по языку браузера — то же правило, что у сервера для
 * `Accept-Language`: язык, который узнаёт парсер, — он, остальные — оригинал
 */
export function audioFromLanguage(tag: string | undefined): FollowAudio {
  const language = tag?.split('-')[0]?.toLowerCase()

  return (
    FOLLOW_AUDIOS.find(audio => audio !== 'original' && audio === language)
    ?? 'original'
  )
}

// «Ждать лучшее»: от «не ждать» до недели, как предел DTO
const WAIT_OPTIONS = [0, 6, 12, 24, 48, 72, 168]

/** Варианты окна; значение не из списка (задано на ТВ или раньше) — тоже в списке */
export function waitOptionsFor(current: number) {
  return WAIT_OPTIONS.includes(current)
    ? WAIT_OPTIONS
    : [...WAIT_OPTIONS, current].sort((a, b) => a - b)
}

/** Цвет состояния серии в карточке: проблемы — цветом, остальное приглушено */
export const EPISODE_TONES = {
  upcoming: 'muted',
  searching: 'muted',
  waiting: 'muted',
  downloading: 'info',
  in_library: 'success',
  ready: 'success',
  no_space: 'destructive',
  missing: 'warning',
} as const satisfies Record<
  FollowDetails['episodes'][number]['state'],
  StatusTone
>

/** Иконка и тон события истории */
export const EVENT_VIEW: Record<string, { icon: Component, tone: StatusTone }>
  = {
    found: { icon: SparklesIcon, tone: 'muted' },
    pending: { icon: ClockIcon, tone: 'muted' },
    grabbed: { icon: DownloadIcon, tone: 'info' },
    picked: { icon: CirclePlayIcon, tone: 'success' },
    downloaded: { icon: LibraryIcon, tone: 'success' },
    upgraded: { icon: CircleArrowUpIcon, tone: 'success' },
    failed: { icon: TriangleAlertIcon, tone: 'warning' },
    blocklisted: { icon: BanIcon, tone: 'muted' },
    missing: { icon: CircleXIcon, tone: 'warning' },
    search: { icon: SearchIcon, tone: 'muted' },
    gap: { icon: TriangleAlertIcon, tone: 'warning' },
    unsure: { icon: CircleHelpIcon, tone: 'warning' },
  }
