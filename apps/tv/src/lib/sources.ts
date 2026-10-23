import type { SourceCandidate, TitleSources } from '@torsher/api-client'

export type Resolution = NonNullable<SourceCandidate['resolution']>
export type VideoClass = Resolution['value']

/** Значение фильтра «Качество»: класс разрешения или `unknown` — не узнать */
export type Quality = VideoClass | 'unknown'

const QUALITY_ORDER: Quality[] = ['2160p', '1080p', '720p', 'SD', 'unknown']

const CLASS_LABELS: Record<VideoClass, string> = {
  '2160p': '4K',
  '1080p': '1080p',
  '720p': '720p',
  'SD': 'SD',
}

const GB = 1024 ** 3
const MB = 1024 ** 2

/**
 * Как показать «Источники»: сортировка и фильтры. `seasons` — для сериала:
 * свежий сезон и больше серий выше, дальше по сидам; `best` — порядок сервера
 * по профилю.
 */
export type SourceSort = 'seasons' | 'best' | 'seeders' | 'size' | 'date'

export interface SourceView {
  sort: SourceSort
  season?: number
  voice?: string
  quality?: Quality
  /** Строка «Уточнить запрос»; без неё — автоматический поиск */
  query?: string
}

export function isQuality(value: unknown): value is Quality {
  return QUALITY_ORDER.includes(value as Quality)
}

/** Выведенное разрешение попадает в свой класс: `SD?` — это SD */
export function qualityOf(candidate: Pick<SourceCandidate, 'resolution'>) {
  return candidate.resolution?.value ?? 'unknown'
}

/** Качества среди раздач, от лучшего к худшему; «не указано» — последним */
export function qualityOptions(candidates: SourceCandidate[]) {
  const found = new Set(candidates.map(qualityOf))

  return QUALITY_ORDER.filter(quality => found.has(quality))
}

/** `4K`, `1080p`, `720p`, `SD` */
export function videoClassLabel(value: VideoClass) {
  return CLASS_LABELS[value]
}

/**
 * Бейдж разрешения: точное — `1080p`, вывод — `SD?`, не узнать — `?`.
 * Тильда в мелком бейдже не читается, вопрос — сразу
 */
export function resolutionBadge(resolution: Resolution | null) {
  if (!resolution)
    return '?'

  const label = CLASS_LABELS[resolution.value]

  return resolution.sure ? label : `${label}?`
}

export type SourceKind = 'remux' | 'bluray' | 'web' | 'tv' | 'dvd' | 'cam'

const SOURCE_KINDS: Record<string, SourceKind> = {
  'BDRemux': 'remux',
  'Blu-ray': 'bluray',
  'BDRip': 'bluray',
  'WEB-DL': 'web',
  'WEBRip': 'web',
  'WEB-DLRip': 'web',
  'HDTV': 'tv',
  'HDTVRip': 'tv',
  'SATRip': 'tv',
  'TVRip': 'tv',
  'DVB': 'tv',
  'IPTV': 'tv',
  'DVD': 'dvd',
  'DVDRip': 'dvd',
  'CAMRip': 'cam',
  'TS': 'cam',
}

/**
 * Откуда видео — понятным словом вместо тега рипа. `HDRip` источник не
 * называет: бейджа нет. Сам тег остаётся в исходном имени раздачи.
 */
export function sourceKindOf(source: string | null) {
  return source ? SOURCE_KINDS[source] : undefined
}

const HDR_LABELS: Record<string, string> = {
  DV: 'Dolby Vision',
  HDR10: 'HDR',
}

/** Dolby Vision первым: он и есть то, ради чего выбирают такую раздачу */
export function hdrLabels(hdr: string[]) {
  return [...hdr]
    .sort((a, b) => Number(b === 'DV') - Number(a === 'DV'))
    .map(item => HDR_LABELS[item] ?? item)
}

/** Сезоны среди раздач по возрастанию */
export function seasonOptions(candidates: SourceCandidate[]) {
  const found = new Set<number>()

  for (const item of candidates) {
    for (const season of item.seasons) found.add(season)
  }

  return Array.from(found).sort((a, b) => a - b)
}

function matchesView(candidate: SourceCandidate, view: SourceView) {
  if (view.quality && qualityOf(candidate) !== view.quality)
    return false

  if (view.season !== undefined && !candidate.seasons.includes(view.season))
    return false

  // Раздача с несколькими озвучками есть в фильтре каждой из них
  return !view.voice || candidate.voiceKeys.includes(view.voice)
}

function lastOf(values: number[]) {
  return values.length > 0 ? Math.max(...values) : 0
}

function compareBy(sort: SourceSort, order: Map<string, number>) {
  return (a: SourceCandidate, b: SourceCandidate) => {
    switch (sort) {
      case 'seasons':
        return (
          lastOf(b.seasons) - lastOf(a.seasons)
          || (b.episodes?.to ?? 0) - (a.episodes?.to ?? 0)
          || b.seeders - a.seeders
        )
      case 'seeders':
        return b.seeders - a.seeders
      case 'size':
        return (b.size ?? 0) - (a.size ?? 0)
      case 'date':
        return (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '')
      default:
        return order.get(a.id)! - order.get(b.id)!
    }
  }
}

/**
 * Строки «Источников»: фильтр и сортировка, а раздачи, которые уже открывали
 * для тайтла, — наверху по сидам: к ним чаще всего возвращаются.
 */
export function arrangeCandidates(
  candidates: SourceCandidate[],
  view: SourceView,
): SourceCandidate[] {
  const order = new Map(candidates.map((item, index) => [item.id, index]))
  const shown = candidates
    .filter(item => matchesView(item, view))
    .sort(compareBy(view.sort, order))
  // Раздача последнего просмотра — первой: её ищут, чтобы смотреть дальше
  return shown
    .filter(item => item.lastWatched)
    .concat(shown.filter(item => !item.lastWatched))
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

/** Покрытие раздачи: «S1 · 1–8», «S1 · E5», пак без диапазона — «S1», несколько сезонов — «S1–3» */
export function coverageLabel(
  candidate: Pick<SourceCandidate, 'seasons' | 'episodes'>,
) {
  const { seasons, episodes } = candidate

  if (seasons.length === 0)
    return ''

  const first = Math.min(...seasons)
  const last = Math.max(...seasons)

  if (first !== last)
    return `S${first}–${last}`

  if (!episodes)
    return `S${first}`

  return episodes.from === episodes.to
    ? `S${first} · E${episodes.from}`
    : `S${first} · ${episodes.from}–${episodes.to}`
}

/**
 * Средний битрейт в Мбит/с: размер на серию (у фильма — весь) за длительность.
 * У пака без диапазона серий размер на серию неизвестен — битрейта нет.
 */
export function bitrateOf(
  candidate: Pick<SourceCandidate, 'episodeSize'>,
  runtimeMinutes: number | undefined,
) {
  if (!candidate.episodeSize || !runtimeMinutes)
    return undefined

  return (candidate.episodeSize * 8) / (runtimeMinutes * 60) / 1_000_000
}

/** «4,2» до 10 Мбит/с, дальше целыми: десятые у крупных чисел — шум */
export function formatBitrate(mbps: number, locale: string) {
  return formatNumber(mbps, mbps < 10 ? 1 : 0, locale)
}

/** Качают: в Torznab `peers` — все пиры вместе с сидами */
export function leechersOf(
  candidate: Pick<SourceCandidate, 'peers' | 'seeders'>,
) {
  if (candidate.peers === null)
    return undefined

  const count = candidate.peers - candidate.seeders

  return count > 0 ? count : undefined
}

/** Минуты с момента поиска для «обновлено N мин назад» */
export function minutesSince(iso: string, now: Date) {
  const time = new Date(iso).getTime()

  return Number.isNaN(time)
    ? 0
    : Math.max(0, Math.floor((now.getTime() - time) / 60_000))
}

/** Индексаторы есть, но ни один не ответил: пустой список — не «ничего не нашлось» */
export function allIndexersFailed(sources: TitleSources) {
  const { total, failed } = sources.indexers

  return total > 0 && failed.length >= total
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
