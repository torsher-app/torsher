import type {
  Backdrop,
  Card,
  CrewJob,
  CrewMember,
  FranchisePart,
  Person,
  PersonCredit,
  PersonDetails,
  PersonRole,
  SeasonDetails,
  TitleDetails,
  TitleExtras,
  TitleRelease,
  TitleSeason,
  TitleStatus,
} from '../../dto/catalog.ts'
import type {
  TmdbAltTitle,
  TmdbCastMember,
  TmdbCrewMember,
  TmdbEpisodeRef,
  TmdbExtras,
  TmdbImage,
  TmdbListResult,
  TmdbMovie,
  TmdbMultiResult,
  TmdbNamed,
  TmdbPerson,
  TmdbPersonCredit,
  TmdbRelease,
  TmdbSeason,
  TmdbTv,
  TmdbTvSeason,
} from './types.ts'
import { tmdbRating } from '../ratings/tmdb.ts'

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
// Фото на странице персоны крупнее, чем в ряду
const PERSON_PHOTO_SIZE = 'w342'
// Только PNG: SVG от внешнего источника на своём origin мог бы выполнить скрипт
const LOGO_FILE = /\.png$/

const MAX_STUDIOS = 3
// Чипы карточки: студий у фильма бывает десяток, keywords — до сотни
const MAX_TAG_STUDIOS = 6
const MAX_KEYWORDS = 20
const MAX_CAST = 20
const MAX_SIMILAR = 20
const MAX_AKA = 6
// Съёмочная группа: на каждую должность не больше трёх человек
const MAX_PER_JOB = 3
// Тайтлов в одной роли фильмографии
const MAX_PERSON_CREDITS = 40
const MAX_SEARCH_PEOPLE = 4
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

const STATUSES: Record<string, TitleStatus> = {
  'Rumored': 'rumored',
  'Planned': 'planned',
  'In Production': 'inProduction',
  'Post Production': 'postProduction',
  'Released': 'released',
  'Returning Series': 'returning',
  'Ended': 'ended',
  'Canceled': 'canceled',
  // Старое написание в части ответов TMDB
  'Cancelled': 'canceled',
  'Pilot': 'pilot',
}

// Типы release_dates TMDB
const THEATRICAL_LIMITED = 2
const THEATRICAL = 3
const DIGITAL = 4

const CATALOG_ID = /^tmdb:(movie|tv):(\d+)$/
const PERSON_ID = /^tmdb:person:(\d+)$/

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

/** ID персоны TMDB: `tmdb:person:525`. Формат, как и у тайтла, знает только сервер. */
export function toPersonId(tmdbId: number) {
  return `tmdb:person:${tmdbId}`
}

export function parsePersonId(id: string): number | undefined {
  const match = PERSON_ID.exec(id)

  return match ? Number(match[1]) : undefined
}

// ru-RU → RU. Позже регион придёт из профиля
export function regionOf(language: string) {
  return language.slice(3)
}

// TMDB отдаёт путь с ведущим слешем: /abc.jpg
function imageUrl(size: string, path: string | null | undefined) {
  return path ? `/api/img/${size}${path}` : undefined
}

/** Та же картинка прокси другой ширины: бэкдроп на карточке 16:9 — `w780` */
export function withImageSize(url: string, size: string) {
  return url.replace(/^\/api\/img\/[^/]+\//, `/api/img/${size}/`)
}

function yearOf(date: string | null | undefined) {
  const year = Number.parseInt(date?.slice(0, 4) ?? '', 10)

  return Number.isFinite(year) ? year : undefined
}

// Остальные оценки добавляет реестр поставщиков
function ratingsOf(item: { vote_average?: number, vote_count?: number }) {
  const tmdb = tmdbRating(item.vote_average, item.vote_count)

  return tmdb ? [tmdb] : []
}

function names(items: { name: string }[] | undefined, limit?: number) {
  // В названиях TMDB встречаются хвостовые пробелы: «NTV , START»
  const list = (items ?? []).map(item => item.name.trim()).filter(Boolean)

  return limit ? list.slice(0, limit) : list
}

function cardRatings(result: TmdbMultiResult) {
  const ratings = ratingsOf(result)

  return ratings.length > 0 ? { ratings } : {}
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
      ...cardRatings(result),
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
      ...cardRatings(result),
    }
  }

  return undefined
}

/** Кадр тайтла из списка TMDB для заставки витрины; без бэкдропа — нет. */
export function listResultToBackdrop(
  result: TmdbListResult,
  type?: TmdbMediaType,
): Backdrop | undefined {
  const card = listResultToCard(result, type)
  const backdrop = imageUrl(BACKDROP_SIZE, result.backdrop_path)

  return card && backdrop
    ? { id: card.id, title: card.title, year: card.year, backdrop }
    : undefined
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

/** Люди из мультипоиска: только с фото, в порядке TMDB. */
export function searchResultsToPeople(results: TmdbMultiResult[]): Person[] {
  return results
    .filter(result => result.media_type === 'person' && result.profile_path)
    .slice(0, MAX_SEARCH_PEOPLE)
    .map(result => ({
      id: toPersonId(result.id),
      name: result.name ?? '',
      photo: imageUrl(PROFILE_SIZE, result.profile_path),
    }))
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

// Пустые строки и нули TMDB — «неизвестно»
function text(value: string | null | undefined) {
  return value?.trim() || undefined
}

// Слоган клиент берёт в кавычки сам, а TMDB часто хранит его уже в кавычках
const QUOTED = /^[«"“„]([^«»"“”„]*)[»"”“]$/

function taglineOf(value: string | null | undefined) {
  const tagline = text(value)

  return tagline?.replace(QUOTED, '$1').trim() || undefined
}

function positive(value: number | null | undefined) {
  return value && value > 0 ? value : undefined
}

function statusOf(value: string | undefined) {
  return value ? STATUSES[value] : undefined
}

// 2026-03-15T00:00:00.000Z → 2026-03-15
function dayOf(value: string | null | undefined) {
  return value && /^\d{4}-\d{2}-\d{2}/.test(value)
    ? value.slice(0, 10)
    : undefined
}

/** Самый ранний релиз страны нужных типов: YYYY-MM-DD. */
function earliestRelease(movie: TmdbMovie, country: string, types: number[]) {
  const releases: TmdbRelease[]
    = movie.release_dates?.results.find(item => item.iso_3166_1 === country)
      ?.release_dates ?? []
  let earliest: string | undefined

  for (const release of releases) {
    const day = dayOf(release.release_date)

    if (
      day
      && release.type !== undefined
      && types.includes(release.type)
      && (!earliest || day < earliest)
    ) {
      earliest = day
    }
  }

  return earliest
}

/**
 * Даты выхода фильма: премьера в мире, кинорелиз в регионе языка, если он
 * позже премьеры, и цифровой релиз в регионе, а без него — в США: с цифрового
 * релиза в сети появляется видео в хорошем качестве.
 */
function movieReleases(movie: TmdbMovie, language: string): TitleRelease[] {
  const region = regionOf(language)
  const premiere = dayOf(movie.release_date)
  const releases: TitleRelease[] = []

  if (premiere)
    releases.push({ type: 'premiere', date: premiere })

  const theatrical = earliestRelease(movie, region, [
    THEATRICAL_LIMITED,
    THEATRICAL,
  ])

  if (theatrical && theatrical !== premiere)
    releases.push({ type: 'theatrical', date: theatrical, country: region })

  for (const country of new Set([region, FALLBACK_REGION])) {
    const digital = earliestRelease(movie, country, [DIGITAL])

    if (digital) {
      releases.push({ type: 'digital', date: digital, country })
      break
    }
  }

  return releases
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
    ratings: ratingsOf(movie),
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
    tagline: taglineOf(movie.tagline),
    status: statusOf(movie.status),
    originalLanguage: text(movie.original_language),
    releases: movieReleases(movie, language),
    budget: positive(movie.budget),
    revenue: positive(movie.revenue),
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
    ratings: ratingsOf(tv),
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
    tagline: taglineOf(tv.tagline),
    status: statusOf(tv.status),
    originalLanguage: text(tv.original_language),
    firstAirDate: dayOf(tv.first_air_date),
    lastAirDate: dayOf(tv.last_air_date),
    nextEpisode: tv.next_episode_to_air
      ? {
          season: tv.next_episode_to_air.season_number,
          episode: tv.next_episode_to_air.episode_number,
          airDate: dayOf(tv.next_episode_to_air.air_date),
        }
      : undefined,
    episodeRuntime: episodeRuntimeOf(tv),
    episodeCount: positive(tv.number_of_episodes),
  }
}

// episode_run_time TMDB у новых сериалов почти всегда пуст: тогда — по последней серии
function episodeRuntimeOf(tv: TmdbTv) {
  return (
    positive(tv.episode_run_time?.[0])
    ?? positive(tv.last_episode_to_air?.runtime)
  )
}

export interface AiredEpisode {
  season: number
  episode: number
  title?: string
  // YYYY-MM-DD
  airDate?: string
  still?: string
}

function airedEpisodeOf(
  ref: TmdbEpisodeRef | null | undefined,
): AiredEpisode | undefined {
  if (!ref)
    return undefined

  return {
    season: ref.season_number,
    episode: ref.episode_number,
    title: ref.name || undefined,
    airDate: ref.air_date || undefined,
    still: imageUrl(STILL_SIZE, ref.still_path),
  }
}

/** Последняя вышедшая и следующая анонсированная серии: статус и «Новые серии» */
export function tvAiring(tv: TmdbTv) {
  return {
    last: airedEpisodeOf(tv.last_episode_to_air),
    next: airedEpisodeOf(tv.next_episode_to_air),
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
    id: toPersonId(member.id),
    name: member.name,
    role: roleOf(member) || undefined,
    photo: imageUrl(PROFILE_SIZE, member.profile_path),
  }
}

// Должности фильма (credits) в группах карточки
const MOVIE_JOBS: Record<string, CrewJob> = {
  'Director': 'director',
  'Screenplay': 'writer',
  'Writer': 'writer',
  'Story': 'writer',
  'Novel': 'writer',
  'Director of Photography': 'camera',
  'Original Music Composer': 'music',
  'Producer': 'producer',
}

// У сериала режиссёров десятки, по серии на каждого: вместо них — создатели
const TV_JOBS: Record<string, CrewJob> = {
  'Writer': 'writer',
  'Teleplay': 'writer',
  'Story': 'writer',
  'Director of Photography': 'camera',
  'Original Music Composer': 'music',
  'Executive Producer': 'producer',
}

const CREW_ORDER: CrewJob[] = [
  'director',
  'creator',
  'writer',
  'camera',
  'music',
  'producer',
]

/** Первые по порядку титров актёры и только нужные должности съёмочной группы. */
export function trimExtras(extras: TmdbExtras): TmdbExtras {
  const byOrder = (cast: TmdbCastMember[]) =>
    [...cast].sort((a, b) => a.order - b.order).slice(0, MAX_CAST)
  const tvCrew = (extras.aggregate_credits?.crew ?? []).flatMap((member) => {
    const jobs = (member.jobs ?? []).filter(item => TV_JOBS[item.job])

    return jobs.length > 0 ? [{ ...member, jobs }] : []
  })

  return {
    title: extras.title,
    original_title: extras.original_title,
    name: extras.name,
    original_name: extras.original_name,
    created_by: extras.created_by,
    credits: extras.credits && {
      cast: byOrder(extras.credits.cast),
      crew: extras.credits.crew.filter(
        member => member.job && MOVIE_JOBS[member.job],
      ),
    },
    aggregate_credits: extras.aggregate_credits && {
      cast: byOrder(extras.aggregate_credits.cast),
      crew: tvCrew,
    },
    recommendations: extras.recommendations,
    belongs_to_collection: extras.belongs_to_collection && {
      id: extras.belongs_to_collection.id,
      name: extras.belongs_to_collection.name,
    },
    alternative_titles: extras.alternative_titles,
    genres: extras.genres,
    production_companies: extras.production_companies?.slice(
      0,
      MAX_TAG_STUDIOS,
    ),
    networks: extras.networks?.slice(0, MAX_TAG_STUDIOS),
    keywords: {
      keywords: extras.keywords?.keywords?.slice(0, MAX_KEYWORDS),
      results: extras.keywords?.results?.slice(0, MAX_KEYWORDS),
    },
  }
}

// Русские жанры TMDB пишет со строчной: «боевик», «драма»
export function capitalized(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function tagsOf(items: TmdbNamed[] | undefined, prefix = '') {
  return (items ?? []).flatMap((item) => {
    const name = item.name.trim()

    return name ? [{ id: `${prefix}${item.id}`, name: capitalized(name) }] : []
  })
}

/**
 * Чипы карточки. Значения — фильтры каталога: жанр и keyword — ID TMDB,
 * студия фильма — `company:<id>`, канал сериала — `network:<id>`.
 */
function extrasTags(extras: TmdbExtras, ref: TmdbRef) {
  return {
    genres: tagsOf(extras.genres),
    studios:
      ref.type === 'movie'
        ? tagsOf(extras.production_companies, 'company:')
        : tagsOf(extras.networks, 'network:'),
    keywords: tagsOf(
      extras.keywords?.keywords ?? extras.keywords?.results,
    ).slice(0, MAX_KEYWORDS),
  }
}

interface CrewCandidate {
  member: TmdbCrewMember
  job: CrewJob
  // У сериала — число серий в должности: кто работал дольше, тот выше
  weight: number
}

/**
 * Съёмочная группа по должностям: у каждой до трёх человек; если у должности
 * есть люди с фото, только они.
 * Человек с несколькими должностями — одна карточка.
 */
function crewOf(extras: TmdbExtras, ref: TmdbRef): CrewMember[] {
  const candidates: CrewCandidate[] = []

  if (ref.type === 'movie') {
    for (const member of extras.credits?.crew ?? []) {
      const job = member.job ? MOVIE_JOBS[member.job] : undefined

      if (job)
        candidates.push({ member, job, weight: 0 })
    }
  }
  else {
    for (const member of extras.created_by ?? [])
      candidates.push({ member, job: 'creator', weight: 0 })

    for (const member of extras.aggregate_credits?.crew ?? []) {
      for (const item of member.jobs ?? []) {
        const job = TV_JOBS[item.job]

        if (job)
          candidates.push({ member, job, weight: item.episode_count })
      }
    }
  }

  const picked = new Map<number, CrewMember>()

  for (const job of CREW_ORDER) {
    const all = candidates.filter(candidate => candidate.job === job)
    // Есть люди с фото — без фото не берём: безликий кружок с инициалами
    // соисполнителя ничего не говорит зрителю
    const withPhoto = all.filter(candidate => candidate.member.profile_path)
    const people = (withPhoto.length > 0 ? withPhoto : all).sort(
      (a, b) => b.weight - a.weight,
    )
    const seen = new Set<number>()

    for (const { member } of people) {
      if (seen.size === MAX_PER_JOB)
        break

      if (seen.has(member.id))
        continue

      seen.add(member.id)

      const known = picked.get(member.id)

      if (known) {
        known.jobs.push(job)
        continue
      }

      picked.set(member.id, {
        id: toPersonId(member.id),
        name: member.name.trim(),
        photo: imageUrl(PROFILE_SIZE, member.profile_path),
        jobs: [job],
      })
    }
  }

  return [...picked.values()]
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

/**
 * Части франшизы по дате выхода. Части без даты — слухи и планы TMDB, их нет;
 * текущий фильм без даты остаётся последним. Одна часть — не франшиза.
 * `watched` заполняет сервис.
 */
export function franchiseParts(
  parts: TmdbListResult[],
  ref: TmdbRef,
): FranchisePart[] {
  const self = toCatalogId(ref.type, ref.tmdbId)
  const dateOf = (part: TmdbListResult) => part.release_date || '9999'
  const list = parts
    .filter(
      part => part.release_date || toCatalogId('movie', part.id) === self,
    )
    .sort((a, b) => dateOf(a).localeCompare(dateOf(b)))
    .flatMap(part => listResultToCard(part, 'movie') ?? [])
    .map(card => ({ ...card, current: card.id === self, watched: false }))

  return list.length > 1 ? list : []
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
    crew: crewOf(extras, ref),
    similar: similarCards(extras.recommendations?.results ?? [], ref),
    franchise: [],
    aka: pickAka(
      altTitles,
      [extras.title, extras.original_title, extras.name, extras.original_name],
      language,
    ),
    directors: ref.type === 'movie' ? [...directors] : [],
    tags: extrasTags(extras, ref),
  }
}

// Роль по должности в группе; сценарий — весь отдел Writing
const CREW_ROLES: Record<string, PersonRole> = {
  'Director': 'directing',
  'Creator': 'creator',
  'Producer': 'production',
  'Executive Producer': 'production',
  'Director of Photography': 'camera',
  'Original Music Composer': 'music',
  'Music': 'music',
  'Editor': 'editing',
}

const DEPARTMENT_ROLES: Record<string, PersonRole> = {
  Acting: 'acting',
  Directing: 'directing',
  Writing: 'writing',
  Production: 'production',
  Camera: 'camera',
  Sound: 'music',
  Editing: 'editing',
}

const ROLE_ORDER: PersonRole[] = [
  'acting',
  'directing',
  'creator',
  'writing',
  'production',
  'camera',
  'music',
  'editing',
]

// Ток-шоу и новости: там персона появляется как гость, а не играет роль
const TALK_GENRES = new Set([10767, 10763])
// Документальное «играет самого себя» — не роль: «Self», «Himself», «Self - Cameo»
const SELF_CHARACTER = /^(?:self|himself|herself|themselves)\b/i

function roleOfCredit(credit: TmdbPersonCredit): PersonRole | undefined {
  if (credit.character !== undefined) {
    const talk = credit.genre_ids?.some(genre => TALK_GENRES.has(genre))

    return talk || SELF_CHARACTER.test(credit.character.trim())
      ? undefined
      : 'acting'
  }

  return (
    (credit.job && CREW_ROLES[credit.job])
    || (credit.department === 'Writing' ? 'writing' : undefined)
  )
}

const PERSON_CREDIT_FIELDS = [
  'id',
  'media_type',
  'title',
  'original_title',
  'release_date',
  'name',
  'original_name',
  'first_air_date',
  'poster_path',
  'popularity',
  'vote_average',
  'vote_count',
  'episode_count',
  'genre_ids',
  'character',
  'department',
  'job',
] as const

function trimCredit(credit: TmdbPersonCredit): TmdbPersonCredit {
  const trimmed: Partial<TmdbPersonCredit> = {}

  for (const field of PERSON_CREDIT_FIELDS) {
    if (credit[field] !== undefined)
      (trimmed as Record<string, unknown>)[field] = credit[field]
  }

  return trimmed as TmdbPersonCredit
}

/**
 * Персона до записи в кэш: у плодовитых актёров сотни записей фильмографии.
 * Остаются только тайтлы с постером и роли, которые показывает витрина.
 */
export function trimPerson(person: TmdbPerson): TmdbPerson {
  const keep = (credit: TmdbPersonCredit) =>
    Boolean(credit.poster_path) && roleOfCredit(credit) !== undefined

  return {
    id: person.id,
    name: person.name,
    profile_path: person.profile_path,
    known_for_department: person.known_for_department,
    birthday: person.birthday,
    deathday: person.deathday,
    place_of_birth: person.place_of_birth,
    biography: person.biography,
    combined_credits: person.combined_credits && {
      cast: person.combined_credits.cast.filter(keep).map(trimCredit),
      crew: person.combined_credits.crew.filter(keep).map(trimCredit),
    },
  }
}

// Гостевое участие в сериале: одна-две серии из сотни у «CSI» не главная работа
const GUEST_EPISODES = 2

interface RoleItem {
  credit: PersonCredit
  popularity: number
  guest: boolean
  details: string[]
}

/**
 * Фильмография по ролям: внутри роли — по популярности TMDB, гостевые серии
 * сериалов — после остального, без повторов
 * (персонажи одного тайтла — через запятую). Первой идёт роль, которой персона
 * известна, дальше — по числу тайтлов. `watched` заполняет сервис.
 */
export function personToDto(person: TmdbPerson): PersonDetails {
  const roles = new Map<PersonRole, Map<string, RoleItem>>()
  const credits = [
    ...(person.combined_credits?.cast ?? []),
    ...(person.combined_credits?.crew ?? []),
  ]

  for (const credit of credits) {
    const role = roleOfCredit(credit)
    const card = searchResultToCard(credit)

    if (!role || !card?.poster)
      continue

    let items = roles.get(role)

    if (!items) {
      items = new Map()
      roles.set(role, items)
    }

    let item = items.get(card.id)

    if (!item) {
      item = {
        credit: { ...card, watched: false },
        popularity: credit.popularity ?? 0,
        guest: true,
        details: [],
      }
      items.set(card.id, item)
    }

    if (
      credit.media_type !== 'tv'
      || (credit.episode_count ?? 0) > GUEST_EPISODES
    ) {
      item.guest = false
    }

    const detail = credit.character?.trim()

    if (detail && !item.details.includes(detail))
      item.details.push(detail)
  }

  const knownFor = person.known_for_department
    ? DEPARTMENT_ROLES[person.known_for_department]
    : undefined
  const groups = [...roles.entries()].map(([role, items]) => ({
    role,
    items: [...items.values()]
      .sort(
        (a, b) =>
          Number(a.guest) - Number(b.guest) || b.popularity - a.popularity,
      )
      .slice(0, MAX_PERSON_CREDITS)
      .map(item => ({
        ...item.credit,
        detail: item.details.join(', ') || undefined,
      })),
    count: items.size,
  }))

  groups.sort(
    (a, b) =>
      Number(b.role === knownFor) - Number(a.role === knownFor)
      || b.count - a.count
      || ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role),
  )

  return {
    id: toPersonId(person.id),
    name: person.name.trim(),
    photo: imageUrl(PERSON_PHOTO_SIZE, person.profile_path),
    knownFor,
    birthday: person.birthday || undefined,
    deathday: person.deathday || undefined,
    placeOfBirth: person.place_of_birth?.trim() || undefined,
    biography: person.biography.trim(),
    credits: groups.map(({ role, items, count }) => ({
      role,
      items,
      total: count,
    })),
  }
}
