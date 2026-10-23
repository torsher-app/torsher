/** Фильтр каталога: живёт в query маршрута, из него строится запрос `/catalog/discover`. */

export const CATALOG_TYPES = [
  'movies',
  'series',
  'cartoons',
  'cartoonSeries',
  'anime',
] as const

export type CatalogType = (typeof CATALOG_TYPES)[number]

export const CATALOG_SORTS = ['popularity', 'rating', 'date'] as const

export type CatalogSort = (typeof CATALOG_SORTS)[number]

/**
 * Источники оценки для фильтра «от N». TMDB `discover` фильтрует только по
 * своей оценке; другой источник добавляется сюда со своим ключом query.
 */
export const RATING_SOURCES = [{ id: 'tmdb', query: 'rating' }] as const

export type RatingSource = (typeof RATING_SOURCES)[number]['id']

export interface RatingFilter {
  source: RatingSource
  min: number
}

// Значение фильтра, которое не вывести из ID: подпись чипа нужна сразу
export interface NamedValue {
  id: string
  name: string
}

export interface CatalogFilter {
  type: CatalogType
  genre?: NamedValue
  year?: number
  decade?: number
  rating?: RatingFilter
  // ISO 639-1
  language?: string
  // ISO 3166-1
  country?: string
  keyword?: NamedValue
  studio?: NamedValue
  sort: CatalogSort
}

export const RATING_STEPS = [8, 7, 6, 5]
export const DECADES = [2020, 2010, 2000, 1990, 1980, 1970, 1960, 1950]
// Лет в панели до десятилетий: текущий и прошлые
const RECENT_YEARS = 5

// Язык оригинала: ISO 639-1 → ISO 639-2, по которому витрина называет языки
export const ORIGINAL_LANGUAGES: Record<string, string> = {
  ru: 'rus',
  en: 'eng',
  uk: 'ukr',
  ja: 'jpn',
  ko: 'kor',
  zh: 'zho',
  fr: 'fra',
  de: 'deu',
  es: 'spa',
  it: 'ita',
  pt: 'por',
  pl: 'pol',
  tr: 'tur',
  hi: 'hin',
  th: 'tha',
}

// Те же страны, что в словаре `countries.*`
export const COUNTRIES = [
  'RU',
  'US',
  'GB',
  'FR',
  'DE',
  'IT',
  'ES',
  'JP',
  'KR',
  'CN',
  'IN',
  'CA',
  'AU',
  'NZ',
  'IE',
  'SE',
  'DK',
  'NO',
  'FI',
  'NL',
  'BE',
  'PL',
  'TR',
  'UA',
  'BY',
  'KZ',
  'BR',
  'MX',
  'AR',
  'HK',
  'TW',
  'TH',
]

const MOVIE_TYPES = new Set<CatalogType>(['movies', 'cartoons'])
// Жанр «Анимация» у мультфильмов, мультсериалов и аниме задан типом
const ANIMATION_GENRE = '16'
const ANIMATED_TYPES = new Set<CatalogType>([
  'cartoons',
  'cartoonSeries',
  'anime',
])
const NUMERIC_ID = /^\d{1,9}$/
const STUDIO_ID = /^(?:company|network):\d{1,9}$/

export function isMovieType(type: CatalogType) {
  return MOVIE_TYPES.has(type)
}

/** Годы панели «Год»: текущий и прошлые, затем десятилетия */
export function recentYears(now: Date) {
  const year = now.getFullYear()

  return Array.from({ length: RECENT_YEARS }, (_, index) => year - index)
}

export function defaultFilter(): CatalogFilter {
  return { type: 'movies', sort: 'popularity' }
}

function stringOf(value: unknown) {
  if (Array.isArray(value))
    return stringOf(value[0])

  return typeof value === 'string' && value ? value : undefined
}

function integerOf(value: unknown, min: number, max: number) {
  const text = stringOf(value)

  if (!text || !/^\d+$/.test(text))
    return undefined

  const number = Number(text)

  return number >= min && number <= max ? number : undefined
}

function oneOf<T extends string>(list: readonly T[], value: unknown) {
  const text = stringOf(value)

  return list.find(item => item === text)
}

function namedOf(id: string | undefined, name: unknown, pattern: RegExp) {
  return id && pattern.test(id)
    ? { id, name: stringOf(name) ?? id }
    : undefined
}

/**
 * Значения, которые к типу не подходят: каналы есть только у сериалов, язык
 * аниме и жанр «Анимация» заданы типом, год и десятилетие не бывают вместе.
 */
export function normalized(filter: CatalogFilter): CatalogFilter {
  const result = { ...filter }

  if (result.studio?.id.startsWith('network:') && isMovieType(result.type))
    delete result.studio

  if (result.type === 'anime')
    delete result.language

  if (result.genre?.id === ANIMATION_GENRE && ANIMATED_TYPES.has(result.type))
    delete result.genre

  if (result.year !== undefined)
    delete result.decade

  return result
}

/** Фильтр из query; непонятные значения отбрасываются, недостающие — по умолчанию */
export function filterOf(query: Record<string, unknown>): CatalogFilter {
  const filter = defaultFilter()
  const type = oneOf(CATALOG_TYPES, query.type)
  const decade = integerOf(query.decade, 1900, 2090)
  const language = stringOf(query.lang)
  const country = stringOf(query.country)

  if (type)
    filter.type = type

  filter.genre = namedOf(stringOf(query.genre), query.genreName, NUMERIC_ID)
  filter.year = integerOf(query.year, 1900, 2100)

  if (decade !== undefined && decade % 10 === 0)
    filter.decade = decade

  for (const source of RATING_SOURCES) {
    const min = integerOf(query[source.query], 1, 9)

    if (min !== undefined)
      filter.rating = { source: source.id, min }
  }

  if (language && ORIGINAL_LANGUAGES[language])
    filter.language = language

  if (country && COUNTRIES.includes(country))
    filter.country = country

  filter.keyword = namedOf(
    stringOf(query.keyword),
    query.keywordName,
    NUMERIC_ID,
  )
  filter.studio = namedOf(stringOf(query.studio), query.studioName, STUDIO_ID)
  filter.sort = oneOf(CATALOG_SORTS, query.sort) ?? filter.sort

  return normalized(withoutUndefined(filter))
}

/** Query маршрута: значения по умолчанию не пишутся */
export function queryOf(filter: CatalogFilter) {
  const query: Record<string, string> = {}
  const base = defaultFilter()

  if (filter.type !== base.type)
    query.type = filter.type

  if (filter.genre) {
    query.genre = filter.genre.id
    query.genreName = filter.genre.name
  }

  if (filter.year !== undefined)
    query.year = String(filter.year)

  if (filter.decade !== undefined)
    query.decade = String(filter.decade)

  if (filter.rating) {
    const source = RATING_SOURCES.find(
      item => item.id === filter.rating?.source,
    )

    if (source)
      query[source.query] = String(filter.rating.min)
  }

  if (filter.language)
    query.lang = filter.language

  if (filter.country)
    query.country = filter.country

  if (filter.keyword) {
    query.keyword = filter.keyword.id
    query.keywordName = filter.keyword.name
  }

  if (filter.studio) {
    query.studio = filter.studio.id
    query.studioName = filter.studio.name
  }

  if (filter.sort !== base.sort)
    query.sort = filter.sort

  return query
}

export interface DiscoverParams {
  type: CatalogType
  genre?: string
  year?: number
  decade?: number
  rating?: number
  originalLanguage?: string
  country?: string
  keyword?: string
  studio?: string
  sort: CatalogSort
}

/** Параметры `/catalog/discover` без языка и страницы */
export function discoverParams(filter: CatalogFilter): DiscoverParams {
  return withoutUndefined({
    type: filter.type,
    genre: filter.genre?.id,
    year: filter.year,
    decade: filter.decade,
    rating: filter.rating?.source === 'tmdb' ? filter.rating.min : undefined,
    originalLanguage: filter.language,
    country: filter.country,
    keyword: filter.keyword?.id,
    studio: filter.studio?.id,
    sort: filter.sort,
  })
}

function withoutUndefined<T extends object>(value: T): T {
  const result = { ...value }

  for (const key of Object.keys(result) as (keyof T)[]) {
    if (result[key] === undefined)
      delete result[key]
  }

  return result
}

/** Фильтр отличается от умолчания: показываем сброс */
export function isChanged(filter: CatalogFilter) {
  return Object.keys(queryOf(filter)).length > 0
}

/**
 * Смена типа: жанры фильмов и сериалов у TMDB разные, поэтому при смене
 * фильмов на сериалы жанр сбрасывается.
 */
export function withType(filter: CatalogFilter, type: CatalogType) {
  const next = { ...filter, type }

  if (isMovieType(type) !== isMovieType(filter.type))
    delete next.genre

  return normalized(next)
}
