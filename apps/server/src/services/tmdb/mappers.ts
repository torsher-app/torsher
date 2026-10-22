import type {
  Card,
  Person,
  SeasonDetails,
  TitleDetails,
  TitleExtras,
  TitleSeason,
} from '../../dto/catalog.ts'
import type {
  TmdbAltTitle,
  TmdbCastMember,
  TmdbExtras,
  TmdbImage,
  TmdbListResult,
  TmdbMovie,
  TmdbMultiResult,
  TmdbSeason,
  TmdbTv,
  TmdbTvSeason,
} from './types.ts'

export type TmdbMediaType = 'movie' | 'tv'

export interface TmdbRef {
  type: TmdbMediaType
  tmdbId: number
}

const POSTER_SIZE = 'w342'
const BACKDROP_SIZE = 'w1280'
const LOGO_SIZE = 'w500'
const STILL_SIZE = 'w300'
const PROFILE_SIZE = 'w185'
// Только PNG: SVG от внешнего источника на своём origin мог бы выполнить скрипт
const LOGO_FILE = /\.png$/

const MAX_STUDIOS = 3
const MAX_CAST = 20
const MAX_SIMILAR = 20
const MAX_AKA = 6
// Регион, у которого возрастной рейтинг есть почти всегда
const FALLBACK_REGION = 'US'
// Другие названия — только латиницей и кириллицей: так их узнают в витрине и в именах раздач
const READABLE_TITLE
  = /^[\p{Script=Latin}\p{Script=Cyrillic}\p{N}\p{P}\p{S}\s]+$/u
const ONGOING_STATUSES = new Set([
  'Returning Series',
  'In Production',
  'Planned',
])

const CATALOG_ID = /^tmdb:(movie|tv):(\d+)$/

/**
 * Каталожный ID тайтла, который ещё не сохранён в базу. Формат знает только
 * сервер: клиенты передают ID обратно как есть.
 */
export function toCatalogId(type: TmdbMediaType, tmdbId: number) {
  return `tmdb:${type}:${tmdbId}`
}

export function parseCatalogId(id: string): TmdbRef | undefined {
  const match = CATALOG_ID.exec(id)

  if (!match)
    return undefined

  return { type: match[1] as TmdbMediaType, tmdbId: Number(match[2]) }
}

// ru-RU → RU. Позже регион придёт из профиля
export function regionOf(language: string) {
  return language.slice(3)
}

// TMDB отдаёт путь с ведущим слешем: /abc.jpg
function imageUrl(size: string, path: string | null | undefined) {
  return path ? `/api/img/${size}${path}` : undefined
}

function yearOf(date: string | null | undefined) {
  const year = Number.parseInt(date?.slice(0, 4) ?? '', 10)

  return Number.isFinite(year) ? year : undefined
}

function ratingOf(average: number, count: number) {
  return count > 0 ? Math.round(average * 10) / 10 : undefined
}

function names(items: { name: string }[] | undefined, limit?: number) {
  // В названиях TMDB встречаются хвостовые пробелы: «NTV , START»
  const list = (items ?? []).map(item => item.name.trim()).filter(Boolean)

  return limit ? list.slice(0, limit) : list
}

/** Персоны из мультипоиска не попадают в каталог. */
export function searchResultToCard(result: TmdbMultiResult): Card | undefined {
  if (result.media_type === 'movie') {
    return {
      id: toCatalogId('movie', result.id),
      kind: 'movie',
      title: result.title ?? '',
      originalTitle: result.original_title ?? result.title ?? '',
      year: yearOf(result.release_date),
      poster: imageUrl(POSTER_SIZE, result.poster_path),
    }
  }

  if (result.media_type === 'tv') {
    return {
      id: toCatalogId('tv', result.id),
      kind: 'series',
      title: result.name ?? '',
      originalTitle: result.original_name ?? result.name ?? '',
      year: yearOf(result.first_air_date),
      poster: imageUrl(POSTER_SIZE, result.poster_path),
    }
  }

  return undefined
}

/**
 * Результаты мультипоиска: сначала прямые совпадения, затем фильмы и сериалы,
 * которыми известны найденные персоны, — так поиск находит тайтл по актёру.
 */
export function searchResultsToCards(results: TmdbMultiResult[]): Card[] {
  const direct = results.flatMap(result => searchResultToCard(result) ?? [])
  const byPeople = results
    .flatMap(result =>
      result.media_type === 'person' ? (result.known_for ?? []) : [],
    )
    .flatMap(result => searchResultToCard(result) ?? [])
  const seen = new Set<string>()

  return [...direct, ...byPeople].filter((card) => {
    if (seen.has(card.id))
      return false

    seen.add(card.id)

    return true
  })
}

/** Элемент списка TMDB. Списки фильмов и сериалов не пишут media_type — его знает вызывающий. */
export function listResultToCard(
  result: TmdbListResult,
  type?: TmdbMediaType,
): Card | undefined {
  const mediaType = result.media_type ?? type

  return mediaType
    ? searchResultToCard({ ...result, media_type: mediaType })
    : undefined
}

/**
 * Логотип на языке интерфейса, затем без текста, затем английский;
 * внутри группы — с лучшей оценкой.
 */
export function pickLogo(
  logos: TmdbImage[] | undefined,
  language: string,
): string | undefined {
  const preferred = [language.slice(0, 2), null, 'en']
  const candidates = (logos ?? []).filter(logo =>
    LOGO_FILE.test(logo.file_path),
  )

  for (const iso of preferred) {
    let best: TmdbImage | undefined

    for (const logo of candidates) {
      if (
        logo.iso_639_1 === iso
        && (!best || logo.vote_average > best.vote_average)
      ) {
        best = logo
      }
    }

    if (best)
      return imageUrl(LOGO_SIZE, best.file_path)
  }

  return undefined
}

/** Рейтинг региона языка, иначе американский; пустые строки TMDB пропускаем. */
function pickByRegion<T>(
  items: T[] | undefined,
  language: string,
  regionOfItem: (item: T) => string,
  value: (item: T) => string | undefined,
) {
  for (const region of [regionOf(language), FALLBACK_REGION]) {
    for (const item of items ?? []) {
      const found = regionOfItem(item) === region ? value(item) : undefined

      if (found)
        return found
    }
  }

  return undefined
}

export function movieToDetails(
  movie: TmdbMovie,
  language = 'en-US',
): TitleDetails {
  return {
    id: toCatalogId('movie', movie.id),
    kind: 'movie',
    title: movie.title,
    originalTitle: movie.original_title,
    year: yearOf(movie.release_date),
    poster: imageUrl(POSTER_SIZE, movie.poster_path),
    backdrop: imageUrl(BACKDROP_SIZE, movie.backdrop_path),
    logo: pickLogo(movie.images?.logos, language),
    overview: movie.overview,
    genres: movie.genres.map(genre => genre.name),
    runtime: movie.runtime || undefined,
    rating: ratingOf(movie.vote_average, movie.vote_count),
    certification: pickByRegion(
      movie.release_dates?.results,
      language,
      result => result.iso_3166_1,
      result =>
        result.release_dates.find(release => release.certification)
          ?.certification,
    ),
    countries: (movie.production_countries ?? []).map(
      country => country.iso_3166_1,
    ),
    studios: names(movie.production_companies, MAX_STUDIOS),
    creators: [],
  }
}

/**
 * Сколько серий сезона вышло. Граница — последняя вышедшая серия сериала;
 * без неё сезон считается вышедшим целиком, если дата его начала прошла.
 */
function airedCount(season: TmdbTvSeason, tv: TmdbTv, now: Date) {
  const last = tv.last_episode_to_air

  if (last) {
    if (season.season_number < last.season_number)
      return season.episode_count

    if (season.season_number > last.season_number)
      return 0

    return Math.min(last.episode_number, season.episode_count)
  }

  const start = season.air_date ? Date.parse(season.air_date) : Number.NaN

  return start <= now.getTime() ? season.episode_count : 0
}

function toSeason(season: TmdbTvSeason, tv: TmdbTv, now: Date): TitleSeason {
  return {
    number: season.season_number,
    name: season.name,
    episodeCount: season.episode_count,
    airedEpisodeCount: airedCount(season, tv, now),
    year: yearOf(season.air_date),
  }
}

/** Спецвыпуски (сезон 0) в ряд сезонов не попадают. */
export function tvToDetails(
  tv: TmdbTv,
  language = 'en-US',
  now = new Date(),
): TitleDetails {
  const ongoing = tv.status ? ONGOING_STATUSES.has(tv.status) : false

  return {
    id: toCatalogId('tv', tv.id),
    kind: 'series',
    title: tv.name,
    originalTitle: tv.original_name,
    year: yearOf(tv.first_air_date),
    poster: imageUrl(POSTER_SIZE, tv.poster_path),
    backdrop: imageUrl(BACKDROP_SIZE, tv.backdrop_path),
    logo: pickLogo(tv.images?.logos, language),
    overview: tv.overview,
    genres: tv.genres.map(genre => genre.name),
    rating: ratingOf(tv.vote_average, tv.vote_count),
    ongoing,
    endYear: ongoing ? undefined : yearOf(tv.last_air_date),
    certification: pickByRegion(
      tv.content_ratings?.results,
      language,
      result => result.iso_3166_1,
      result => result.rating,
    ),
    countries: tv.origin_country ?? [],
    studios: names(tv.networks, MAX_STUDIOS),
    creators: names(tv.created_by),
    seasons: tv.seasons
      .filter(season => season.season_number > 0)
      .map(season => toSeason(season, tv, now)),
  }
}

export function seasonToDetails(season: TmdbSeason): SeasonDetails {
  return {
    number: season.season_number,
    name: season.name,
    episodes: season.episodes.map(episode => ({
      number: episode.episode_number,
      title: episode.name,
      overview: episode.overview,
      airDate: episode.air_date || undefined,
      runtime: episode.runtime || undefined,
      still: imageUrl(STILL_SIZE, episode.still_path),
    })),
  }
}

// У сериала роль — персонаж, которого актёр играл в большинстве серий
function roleOf(member: TmdbCastMember) {
  if (member.character)
    return member.character

  let best: { character: string, episode_count: number } | undefined

  for (const role of member.roles ?? []) {
    if (role.character && (!best || role.episode_count > best.episode_count))
      best = role
  }

  return best?.character
}

function toPerson(member: TmdbCastMember): Person {
  return {
    id: `tmdb:person:${member.id}`,
    name: member.name,
    role: roleOf(member) || undefined,
    photo: imageUrl(PROFILE_SIZE, member.profile_path),
  }
}

/** Первые по порядку титров актёры и только режиссёры из съёмочной группы. */
export function trimExtras(extras: TmdbExtras): TmdbExtras {
  const byOrder = (cast: TmdbCastMember[]) =>
    [...cast].sort((a, b) => a.order - b.order).slice(0, MAX_CAST)

  return {
    title: extras.title,
    original_title: extras.original_title,
    name: extras.name,
    original_name: extras.original_name,
    credits: extras.credits && {
      cast: byOrder(extras.credits.cast),
      crew: extras.credits.crew.filter(member => member.job === 'Director'),
    },
    aggregate_credits: extras.aggregate_credits && {
      cast: byOrder(extras.aggregate_credits.cast),
    },
    recommendations: extras.recommendations,
    alternative_titles: extras.alternative_titles,
  }
}

/**
 * Другие названия: сначала региона языка, без совпадений с названием и
 * оригинальным названием, без повторов с точностью до регистра и только
 * латиницей или кириллицей.
 */
function pickAka(
  titles: TmdbAltTitle[],
  known: (string | undefined)[],
  language: string,
) {
  const region = regionOf(language)
  const seen = new Set(
    known.flatMap(title => (title ? [title.toLowerCase()] : [])),
  )
  const ordered = [
    ...titles.filter(title => title.iso_3166_1 === region),
    ...titles.filter(title => title.iso_3166_1 !== region),
  ]
  const aka: string[] = []

  for (const { title } of ordered) {
    const key = title.trim().toLowerCase()

    if (!key || seen.has(key) || !READABLE_TITLE.test(key))
      continue

    seen.add(key)
    aka.push(title.trim())

    if (aka.length === MAX_AKA)
      break
  }

  return aka
}

/** Карточки «Похожего» с постером, без самого тайтла. */
export function similarCards(results: TmdbListResult[], ref: TmdbRef): Card[] {
  const self = toCatalogId(ref.type, ref.tmdbId)

  return results
    .flatMap(result => listResultToCard(result, ref.type) ?? [])
    .filter(card => card.poster && card.id !== self)
    .slice(0, MAX_SIMILAR)
}

export function extrasToDto(
  extras: TmdbExtras,
  ref: TmdbRef,
  language: string,
): TitleExtras {
  const credits
    = ref.type === 'movie' ? extras.credits : extras.aggregate_credits
  const altTitles
    = extras.alternative_titles?.titles
      ?? extras.alternative_titles?.results
      ?? []
  const directors = new Set(
    (extras.credits?.crew ?? [])
      .filter(member => member.job === 'Director')
      .map(member => member.name),
  )

  return {
    cast: [...(credits?.cast ?? [])]
      .sort((a, b) => a.order - b.order)
      .slice(0, MAX_CAST)
      .map(toPerson),
    similar: similarCards(extras.recommendations?.results ?? [], ref),
    aka: pickAka(
      altTitles,
      [extras.title, extras.original_title, extras.name, extras.original_name],
      language,
    ),
    directors: ref.type === 'movie' ? [...directors] : [],
  }
}
