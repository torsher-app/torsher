import type { ParsedRelease } from './types.ts'
import { normalizeTitle, titleKey } from './normalize.ts'

/**
 * `high` — раздача этого тайтла, `medium` — похоже, но есть сомнение
 * (часть названия, год вне допуска, сезон не указан), `low` — чужая раздача.
 */
export type MatchConfidence = 'high' | 'medium' | 'low'

/**
 * Что не сошлось: `title` — название не совпало ни с одним алиасом,
 * `partialTitle` — совпало начало (вместе с другим сомнением — чужая раздача), `year` — год вне допуска, `kind` — фильм
 * вместо сериала или наоборот, `season` — нужного сезона в раздаче нет,
 * `noSeason` — сезон в раздаче не указан.
 */
export type MatchIssue
  = 'title' | 'partialTitle' | 'year' | 'kind' | 'season' | 'noSeason'

export interface TitleTarget {
  kind: 'movie' | 'series'
  /** Все известные названия тайтла: официальные, оригинальное, другие, транслит. */
  aliases: string[]
  year?: number
  /** Год последнего эфира завершённого сериала; у идущего не задаётся. */
  endYear?: number
  /** Сезон, раздачи которого ищем. */
  season?: number
}

export interface TitleMatch {
  confidence: MatchConfidence
  issues: MatchIssue[]
}

const EXPLICIT_KIND = 0.8

// Ключ из двух букв совпадает у слишком многих названий
const MIN_KEY_LENGTH = 3

function releaseNames(parsed: ParsedRelease) {
  const { ru, orig, translit, alt = [] } = parsed.titles

  return [ru, orig, translit, ...alt].filter((name): name is string => !!name)
}

function startsWithWords(text: string, prefix: string) {
  return prefix.length >= 4 && text.startsWith(`${prefix} `)
}

function compareTitles(
  parsed: ParsedRelease,
  aliases: string[],
): 'exact' | 'partial' | 'none' {
  const normalized = new Set(aliases.map(normalizeTitle).filter(Boolean))
  const keys = new Set(
    aliases.map(titleKey).filter(key => key.length >= MIN_KEY_LENGTH),
  )
  const names = releaseNames(parsed)

  for (const name of names) {
    const key = titleKey(name)

    if (normalized.has(normalizeTitle(name)) || keys.has(key))
      return 'exact'
  }

  for (const name of names) {
    const text = normalizeTitle(name)

    for (const alias of normalized) {
      if (startsWithWords(text, alias) || startsWithWords(alias, text))
        return 'partial'
    }
  }

  return 'none'
}

function yearFits(year: number, target: TitleTarget) {
  if (target.year === undefined)
    return true

  if (target.kind === 'movie')
    return Math.abs(year - target.year) <= 1

  // У сериала в раздаче бывает год сезона, а не год начала
  return (
    year >= target.year - 1
    && (target.endYear === undefined || year <= target.endYear + 1)
  )
}

function seasonIssue(
  parsed: ParsedRelease,
  season: number,
): MatchIssue | undefined {
  if (parsed.seasons.length > 0)
    return parsed.seasons.includes(season) ? undefined : 'season'

  // Без сезона, но с сериями — обычно первый сезон
  if (parsed.episodes && season === 1)
    return undefined

  return 'noSeason'
}

/**
 * Проверяет, что раздача относится к тайтлу. Тайтл уже известен (поиск
 * идёт из карточки), поэтому задача — отсеять омонимы и чужие сезоны.
 */
export function matchTitle(
  parsed: ParsedRelease,
  target: TitleTarget,
): TitleMatch {
  const issues: MatchIssue[] = []
  const title = compareTitles(parsed, target.aliases)

  if (title === 'none')
    return { confidence: 'low', issues: ['title'] }

  if (title === 'partial')
    issues.push('partialTitle')

  const isSeriesRelease = parsed.seasons.length > 0 || !!parsed.episodes
  // Фильмом парсер считает и всё, где нет серий; чужим такое считаем
  // только при явной пометке в названии
  const isMovieRelease
    = parsed.kind === 'movie' && (parsed.confidence.kind ?? 0) >= EXPLICIT_KIND

  if (
    (target.kind === 'series' && isMovieRelease)
    || (target.kind === 'movie' && isSeriesRelease)
  ) {
    return { confidence: 'low', issues: [...issues, 'kind'] }
  }

  if (target.kind === 'series' && target.season !== undefined) {
    const issue = seasonIssue(parsed, target.season)

    if (issue === 'season')
      return { confidence: 'low', issues: [...issues, issue] }

    if (issue)
      issues.push(issue)
  }

  if (parsed.year !== undefined && !yearFits(parsed.year, target))
    issues.push('year')

  // Похожее начало без сезона или с чужим годом — другой тайтл
  // («Пациент Зеро (2018)» для «Пациента»), а не продолжение с подзаголовком
  if (issues.includes('partialTitle') && issues.length > 1)
    return { confidence: 'low', issues }

  return { confidence: issues.length > 0 ? 'medium' : 'high', issues }
}
