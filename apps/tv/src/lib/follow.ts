import type { ScheduleItem, TitleFollow } from '@torsher/api-client'

/** «Новая серия»: скачать в библиотеку или только уведомить */
export const FOLLOW_MODES = ['download', 'notify'] as const

/** «Ждать лучшее»: не ждать, 12 ч, сутки, 3 дня */
export const WAIT_HOURS = [0, 12, 24, 72]

export const QUALITY_PRESETS = ['best', 'uhd', 'compact'] as const

export type FollowAudio = TitleFollow['audioEffective']

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
 * Пункты шага «Озвучка»: первым — «как у сервера». У русской — студии
 * сезона, оригинал и вложенный шаг с другими языками; у остальных — сразу
 * список языков: студий у них нет
 */
export function voiceChoices(
  follow: Pick<TitleFollow, 'audioEffective'>,
  studio: string | undefined,
): string[] {
  if (follow.audioEffective !== 'ru')
    return ['server', ...FOLLOW_AUDIOS]

  const studios = studio ? ['prefer', 'only', 'any'] : ['any']

  return ['server', ...studios, 'original', 'languages']
}

/** Языки вложенного шага «Другой язык»: оригинал уже есть уровнем выше */
export const OTHER_AUDIOS = FOLLOW_AUDIOS.filter(id => id !== 'original')

export function isFollowAudio(id: string): id is FollowAudio {
  return (FOLLOW_AUDIOS as readonly string[]).includes(id)
}

/** Лестницы пресетов, как у решателя на сервере: первое — верхняя ступень */
export const QUALITY_LADDERS: Record<
  (typeof QUALITY_PRESETS)[number],
  string[]
> = {
  best: ['1080p', '720p', 'SD'],
  uhd: ['2160p', '1080p', '720p'],
  compact: ['720p', 'SD'],
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

/** Код серии для статуса: «S2E6» */
export function episodeCode(episode: { season: number, episode: number }) {
  return `S${episode.season}E${episode.episode}`
}

/** Серий в состоянии и код первой из них */
interface EpisodeCount {
  count: number
  code: string
}

export type FollowStatus
  = | { kind: 'paused' }
    | ({ kind: 'noSpace' } & EpisodeCount)
    | { kind: 'ready', code: string }
    | {
      kind: 'waiting'
      waiting: NonNullable<TitleFollow['waiting']>
      code: string
    }
    | ({ kind: 'downloading' } & EpisodeCount)
    | ({ kind: 'missing' } & EpisodeCount)
    | ({ kind: 'searching' } & EpisodeCount)
    | { kind: 'next', code: string, airDate: string }

/**
 * Главное в статус-строке карточки, по важности для зрителя: пауза, нет места,
 * готовая серия, которую профиль не досмотрел, ждём лучшее, качается, не
 * нашли, ищем, следующая серия с датой
 */
export function followStatus(follow: TitleFollow): FollowStatus | undefined {
  const { counts, first } = follow
  // У ненулевого счётчика первая серия есть всегда, необязательна она только по типу
  const counted = (
    count: number,
    episode: { season: number, episode: number } | undefined,
  ) => ({ count, code: episode ? episodeCode(episode) : '' })

  if (follow.state === 'paused')
    return { kind: 'paused' }

  if (counts.noSpace)
    return { kind: 'noSpace', ...counted(counts.noSpace, first.noSpace) }

  if (follow.ready)
    return { kind: 'ready', code: episodeCode(follow.ready) }

  if (follow.waiting) {
    return {
      kind: 'waiting',
      waiting: follow.waiting,
      code: episodeCode(follow.waiting),
    }
  }

  if (counts.downloading) {
    return {
      kind: 'downloading',
      ...counted(counts.downloading, first.downloading),
    }
  }

  if (counts.missing)
    return { kind: 'missing', ...counted(counts.missing, first.missing) }

  if (counts.searching)
    return { kind: 'searching', ...counted(counts.searching, first.searching) }

  const next = follow.next

  return next?.airDate
    ? { kind: 'next', code: episodeCode(next), airDate: next.airDate }
    : undefined
}

export type EpisodesKind = 'noSpace' | 'downloading' | 'missing' | 'searching'

const MOVIE_KEYS: Record<EpisodesKind, string> = {
  noSpace: 'movieNoSpace',
  downloading: 'movieDownloading',
  missing: 'movieMissing',
  searching: 'movieSearching',
}

/**
 * Ключ `follow.status.*` про серии: одна — строкой с кодом, несколько —
 * `*Many` с числом (в русском 21 серия иначе взяла бы форму одной); у фильма
 * свои строки без кода
 */
export function episodesStatusKey(
  kind: EpisodesKind,
  count: number,
  movie: boolean,
) {
  if (movie)
    return MOVIE_KEYS[kind]

  return count === 1 ? kind : `${kind}Many`
}

/** Ключ `follow.status.*` ожидания: знаем, чего ждём, или просто лучшее */
export function waitingStatusKey(hasTarget: boolean, movie: boolean) {
  if (movie)
    return hasTarget ? 'movieWaiting' : 'movieWaitingBetter'

  return hasTarget ? 'waiting' : 'waitingBetter'
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
