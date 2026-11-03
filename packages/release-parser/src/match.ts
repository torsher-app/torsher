import type { ParsedRelease } from './types.ts'
import { normalizeTitle, titleKey, transliterate } from './normalize.ts'
import { tokenize } from './tokenize.ts'

/**
 * `high` — раздача этого тайтла, `medium` — похоже, но есть сомнение
 * (часть названия, год вне допуска, сезон не указан), `low` — чужая раздача.
 */
export type MatchConfidence = 'high' | 'medium' | 'low'

/**
 * Что не сошлось: `title` — название не совпало ни с одним алиасом,
 * `partialTitle` — совпало начало (вместе с другим сомнением — чужая раздача),
 * `prefixedTitle` — полное название после одного структурного префикса,
 * `similarTitle` — совпало только написание без мягкого знака, удвоений и
 * вариантов транслита («Мат» и «Мать»), а год этого не подтвердил,
 * `year` — год вне допуска, `kind` — фильм вместо сериала или наоборот,
 * `season` — нужного сезона в раздаче нет, `noSeason` — сезон в раздаче не
 * указан; `content` — явно игра, саундтрек или трейлер.
 */
export type MatchIssue
  = | 'title'
    | 'partialTitle'
    | 'prefixedTitle'
    | 'similarTitle'
    | 'year'
    | 'kind'
    | 'season'
    | 'noSeason'
    | 'content'

export interface TitleTarget {
  kind: 'movie' | 'series'
  /** Все известные названия тайтла: официальные, оригинальное, другие, транслит. */
  aliases: string[]
  year?: number
  /** Год последнего эфира завершённого сериала; у идущего не задаётся. */
  endYear?: number
  /** Годы начала сезонов; начало следующего ограничивает предыдущий. */
  seasonYears?: Record<number, number>
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

const CYRILLIC = /\p{Script=Cyrillic}/u

/**
 * Одно название: нормализованные строки равны, а в разной письменности —
 * равна транслитерация. Внутри одной письменности транслитерация не
 * сравнивается: она теряет мягкий знак («Мать» и «Мат»).
 */
function sameTitle(a: string, b: string) {
  if (a === b)
    return true

  return (
    CYRILLIC.test(a) !== CYRILLIC.test(b)
    && transliterate(a) === transliterate(b)
  )
}

const TITLE_PREFIX = /[:|]\s*|\.\s+|\s+[-–—]\s+/u
const SUPPLEMENTARY_PREFIXES = new Set([
  'making of',
  'behind the scenes',
  'фильм о фильме',
  'за кадром',
])

function prefixedNames(parsed: ParsedRelease) {
  const names = releaseNames(parsed)
  const prefixed = names.flatMap((name) => {
    const boundary = TITLE_PREFIX.exec(name)
    if (!boundary || boundary.index === 0)
      return []
    return [
      {
        name,
        prefix: name.slice(0, boundary.index),
        rest: name.slice(boundary.index + boundary[0].length),
      },
    ]
  })
  return prefixed
}

function compareTitles(
  parsed: ParsedRelease,
  aliases: string[],
): 'exact' | 'similar' | 'partial' | 'prefixed' | 'content' | 'none' {
  const normalized = new Set(aliases.map(normalizeTitle).filter(Boolean))
  const keys = new Set(
    aliases.map(titleKey).filter(key => key.length >= MIN_KEY_LENGTH),
  )
  const names = releaseNames(parsed)
  const prefixed = prefixedNames(parsed)
  const supplementary = prefixed.filter(item =>
    SUPPLEMENTARY_PREFIXES.has(normalizeTitle(item.prefix)),
  )
  // Полное название на любом языке подтверждает именно дополнительный фильм.
  // Алиас исходного фильма без пометки такого подтверждения не даёт.
  const supplementaryTarget = supplementary.some(item =>
    [...normalized].some(alias =>
      sameTitle(normalizeTitle(item.name), alias),
    ),
  )
  if (supplementary.length && !supplementaryTarget)
    return 'content'

  for (const name of names) {
    const text = normalizeTitle(name)

    if ([...normalized].some(alias => sameTitle(text, alias)))
      return 'exact'
  }

  if (prefixed.some(item => normalized.has(normalizeTitle(item.rest))))
    return 'prefixed'

  if (names.some(name => keys.has(titleKey(name))))
    return 'similar'

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

/** Год пака может относиться к любому из содержащихся в нём сезонов. */
function seasonYearFits(parsed: ParsedRelease, target: TitleTarget) {
  if (target.kind !== 'series' || parsed.year === undefined)
    return true

  const year = parsed.year
  // Раздачи поздних сезонов также подписывают годом начала всего сериала.
  if (target.year !== undefined && Math.abs(year - target.year) <= 1)
    return true
  // Абсолютная нумерация аниме не означает первый сезон.
  if (parsed.seasons.length === 0 && parsed.absolute)
    return true

  const seasons = parsed.seasons.length ? parsed.seasons : [1]
  return seasons.some((season) => {
    const start
      = target.seasonYears?.[season] ?? (season === 1 ? target.year : undefined)
    const next = target.seasonYears?.[season + 1]
    if (start === undefined)
      return target.year === undefined || Math.abs(year - target.year) <= 1

    if (year < start - 1)
      return false
    if (next !== undefined)
      return year <= next
    // Неизвестный конец не доказывает принадлежность позднего года сезону.
    return year <= start + 1
  })
}

/** Только явные сочетания метаданных; слова внутри названия не запрещены. */
function nonFeatureContent(parsed: ParsedRelease) {
  const raw = parsed.raw.toLowerCase()
  // Ищем конец разобранных названий по позициям токенов: префикс группы
  // [DEMO] и слова Trailer/Game внутри самого названия не являются тегами.
  const words = tokenize(raw).tokens.flatMap(token =>
    normalizeTitle(token.value)
      .split(' ')
      .filter(Boolean)
      .map(word => ({ word, end: token.end })),
  )
  let titleEnd = 0
  let firstTitleEnd = raw.length
  for (const name of releaseNames(parsed)) {
    const titleWords = normalizeTitle(name).split(' ').filter(Boolean)
    if (!titleWords.length)
      continue
    for (let index = 0; index <= words.length - titleWords.length; index++) {
      if (
        titleWords.every((word, offset) => word === words[index + offset]!.word)
      ) {
        const end = words[index + titleWords.length - 1]!.end
        titleEnd = Math.max(titleEnd, end)
        firstTitleEnd = Math.min(firstTitleEnd, end)
      }
    }
  }
  const tail = titleEnd ? raw.slice(titleEnd) : ''
  const game
    = /\b(?:pc|windows|ps[2-5]|xbox)\b/.test(tail)
      && (/\b(?:repack|game)\b/.test(raw)
        || /игра/.test(tail)
        || (!parsed.source && !parsed.quality && !parsed.codec))
  const audio
    = (/\b(?:ost|soundtrack)\b|саундтрек/.test(tail)
      || /^\s*(?:ost|soundtrack|саундтрек)\s*[-:]/i.test(raw))
    && /\b(?:mp3|flac|ape|lossless)\b/.test(tail)
  const trailer = /(?:^|[\s.[(|/-])(?:trailer|трейлер)(?=$|[\s.\])|/-])/i.test(
    tail,
  )

  const trailerLabel = /[[(]\s*(?:trailer|трейлер)\s*[)\]]/i.test(
    raw.slice(firstTitleEnd),
  )
  return game || audio || trailer || trailerLabel
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
  if (nonFeatureContent(parsed))
    return { confidence: 'low', issues: ['content'] }

  const issues: MatchIssue[] = []
  const title = compareTitles(parsed, target.aliases)

  if (title === 'content')
    return { confidence: 'low', issues: ['content'] }

  if (title === 'prefixed')
    issues.push('prefixedTitle')

  if (title === 'none')
    return { confidence: 'low', issues: ['title'] }

  if (title === 'partial')
    issues.push('partialTitle')

  // Ключ сводит и разные слова: такое совпадение подтверждает только год
  if (
    title === 'similar'
    && (parsed.year === undefined
      || target.year === undefined
      || !yearFits(parsed.year, target))
  ) {
    issues.push('similarTitle')
  }

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

  if (
    parsed.year !== undefined
    && (!yearFits(parsed.year, target) || !seasonYearFits(parsed, target))
  ) {
    issues.push('year')
  }

  // Похожее начало без сезона или с чужим годом — другой тайтл
  // («Пациент Зеро (2018)» для «Пациента»), а не продолжение с подзаголовком
  if (
    (issues.includes('partialTitle') || issues.includes('prefixedTitle'))
    && issues.length > 1
  ) {
    return { confidence: 'low', issues }
  }

  return { confidence: issues.length > 0 ? 'medium' : 'high', issues }
}
