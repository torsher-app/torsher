import type {
  SourceCandidate,
  TitleProgress,
  TitleSeason,
  TitleSources,
} from '@torsher/api-client'

export type Quality = NonNullable<SourceCandidate['quality']>

const QUALITY_ORDER: Quality[] = [
  '2160p',
  '1440p',
  '1080p',
  '1080i',
  '720p',
  '576p',
  '480p',
  '360p',
]

export const TOP_SIZE = 3
// Тот же порог, что у сервера: раньше продолжать нечего
const RESUME_MIN_SECONDS = 30
const GB = 1024 ** 3
const MB = 1024 ** 2

/** Ключ озвучки, как у сервера: студия, а без неё — тип перевода */
export function voiceKeyOf(voice: { studio?: string, type?: string }) {
  return voice.studio ? `studio:${voice.studio}` : `type:${voice.type ?? 'ru'}`
}

export interface SourceFilter {
  voice?: string
  quality?: Quality
}

/** Качества среди раздач, от лучшего к худшему */
export function qualityOptions(candidates: SourceCandidate[]) {
  const found = new Set(candidates.map(item => item.quality))

  return QUALITY_ORDER.filter(quality => found.has(quality))
}

function matchesFilter(candidate: SourceCandidate, filter: SourceFilter) {
  if (filter.quality && candidate.quality !== filter.quality)
    return false

  return (
    !filter.voice
    || (!!candidate.voice && voiceKeyOf(candidate.voice) === filter.voice)
  )
}

/**
 * Строки листа: без фильтров — тройка сервера, с фильтрами — лучшие три
 * уверенных совпадения с сидами, «Показать все» — всё по убыванию счёта.
 */
export function visibleCandidates(
  sources: TitleSources,
  filter: SourceFilter,
  showAll: boolean,
): SourceCandidate[] {
  const filtered = sources.candidates.filter(item =>
    matchesFilter(item, filter),
  )

  if (showAll)
    return filtered

  if (!filter.voice && !filter.quality) {
    const byId = new Map(sources.candidates.map(item => [item.id, item]))

    // Без flatMap: его нет в Chromium 68
    return sources.top.reduce<SourceCandidate[]>((list, id) => {
      const found = byId.get(id)

      return found ? [...list, found] : list
    }, [])
  }

  return filtered
    .filter(item => item.confidence === 'high' && item.seeders > 0)
    .slice(0, TOP_SIZE)
}

/** Сколько раздач покажет «Показать все» с текущими фильтрами */
export function filteredCount(sources: TitleSources, filter: SourceFilter) {
  return sources.candidates.filter(item => matchesFilter(item, filter))
    .length
}

/** Размер на серию, а без него — весь размер раздачи */
export function sizeOf(candidate: SourceCandidate) {
  return candidate.episodeSize ?? candidate.size
}

function formatNumber(value: number, digits: number, locale: string) {
  const tag = locale.replace('_', '-')

  if (
    typeof Intl !== 'undefined'
    && Intl.NumberFormat.supportedLocalesOf([tag]).length > 0
  ) {
    return new Intl.NumberFormat(tag, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value)
  }

  return value.toFixed(digits)
}

/** Размер с единицей: гигабайты с одним знаком, меньше гигабайта — мегабайты */
export function formatSize(bytes: number, locale: string) {
  return bytes >= GB
    ? { amount: formatNumber(bytes / GB, 1, locale), unit: 'gb' as const }
    : {
        amount: formatNumber(Math.max(1, bytes / MB), 0, locale),
        unit: 'mb' as const,
      }
}

/** Минуты с момента поиска для «обновлено N мин назад» */
export function minutesSince(iso: string, now: Date) {
  const time = new Date(iso).getTime()

  return Number.isNaN(time)
    ? 0
    : Math.max(0, Math.floor((now.getTime() - time) / 60_000))
}

export interface WatchTarget {
  season?: number
  episode?: number
  /** Продолжить начатую серию или фильм. */
  resume: boolean
  /** Сколько секунд осталось у продолжаемого. */
  remaining?: number
}

type Progress = TitleProgress['last']

function canResume(last: NonNullable<Progress>) {
  return !last.watched && last.position >= RESUME_MIN_SECONDS
}

function remainingOf(last: NonNullable<Progress>) {
  return last.duration ? Math.max(0, last.duration - last.position) : undefined
}

function firstAired(seasons: TitleSeason[]) {
  return seasons.find(item => item.airedEpisodeCount > 0) ?? seasons[0]
}

/**
 * Что запустит главная кнопка: начатая серия — продолжить, досмотренная —
 * следующая вышедшая, иначе первая серия первого вышедшего сезона.
 */
export function watchTarget(
  kind: 'movie' | 'series',
  seasons: TitleSeason[],
  last: Progress,
): WatchTarget {
  if (kind === 'movie') {
    return last && canResume(last)
      ? { resume: true, remaining: remainingOf(last) }
      : { resume: false }
  }

  if (last?.season && last.episode) {
    if (canResume(last)) {
      return {
        season: last.season,
        episode: last.episode,
        resume: true,
        remaining: remainingOf(last),
      }
    }

    const index = seasons.findIndex(item => item.number === last.season)
    const current = seasons[index]

    if (last.watched && current && last.episode < current.airedEpisodeCount)
      return { season: last.season, episode: last.episode + 1, resume: false }

    const next = seasons
      .slice(index + 1)
      .find(item => item.airedEpisodeCount > 0)

    if (last.watched && index !== -1 && next)
      return { season: next.number, episode: 1, resume: false }

    return { season: last.season, episode: last.episode, resume: false }
  }

  const first = firstAired(seasons)

  return { season: first?.number ?? 1, episode: 1, resume: false }
}

/** Лучший кандидат для подписи главной кнопки */
export function bestCandidate(sources: TitleSources | undefined) {
  const id = sources?.top[0]

  return id ? sources!.candidates.find(item => item.id === id) : undefined
}

export interface PlaybackTitle {
  id: string
  season?: number
  episode?: number
}

function positiveInt(value: string | undefined) {
  const number = Number(value)

  return Number.isInteger(number) && number > 0 ? number : undefined
}

/** Контекст тайтла из адреса плеера; без ID тайтла — плеер по ссылке из панели */
export function titleRefOf(
  id: string | undefined,
  season: string | undefined,
  episode: string | undefined,
): PlaybackTitle | undefined {
  if (!id)
    return undefined

  return { id, season: positiveInt(season), episode: positiveInt(episode) }
}
