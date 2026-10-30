import type {
  Card,
  Person,
  PersonDetails,
  SeasonDetails,
  TitleDetails,
  TitleExtras,
} from '../../dto/catalog.ts'
import type { TmdbRef } from './mappers.ts'
import type {
  TmdbChanges,
  TmdbCollection,
  TmdbExtras,
  TmdbListResponse,
  TmdbMovie,
  TmdbMultiResult,
  TmdbPerson,
  TmdbSearchResponse,
  TmdbSeason,
  TmdbTv,
} from './types.ts'
import {
  ratingsOf,
  rememberImdbIdIfChanged,
  withRatings,
} from '../ratings/index.ts'
import { TMDB_PROVIDER } from '../ratings/tmdb.ts'
import {
  metaCacheKeys,
  readMetaCache,
  storeMetaCache,
  withMetaCache,
} from './cache.ts'
import { tmdbGet } from './client.ts'
import { getTrendingCards } from './home.ts'
import {
  extrasToDto,
  franchiseParts,
  movieToDetails,
  parseCatalogId,
  parsePersonId,
  personToDto,
  searchResultsToCards,
  searchResultsToPeople,
  seasonToDetails,
  similarCards,
  trackerSeasonName,
  trimExtras,
  trimPerson,
  tvAiring,
  tvToDetails,
  withTrackerEpisodes,
  withTrackerSeason,
} from './mappers.ts'
import { trackerEpisodesOf } from './tracker.ts'

export { fetchTmdbImage, TmdbError } from './client.ts'
export { discoverTitles, getGenres } from './discover.ts'
export { getHomeRows, getTrendingBackdrops } from './home.ts'
export { getTitleIdentity } from './identity.ts'
export type { TitleIdentity, TitleName, TitleNameKind } from './identity.ts'

const HOUR_MS = 60 * 60 * 1000
const SEARCH_TTL_MS = HOUR_MS
// Столько выдаёт одна страница TMDB: с вариантами е/ё ответ не длиннее
const SEARCH_PAGE_SIZE = 20
// Каждая догадка — отдельный запрос в TMDB на каждый набранный запрос
const MAX_YO_GUESSES = 3
const DETAILS_TTL_MS = 7 * 24 * HOUR_MS
// Названия и даты серий идущего сезона меняются чаще деталей
const SEASON_TTL_MS = 24 * HOUR_MS
const TRENDING_LIMIT = 12

/**
 * В кэше лежит сырой ответ: при смене набора append_to_response версия
 * меняется, иначе до конца TTL отдавались бы ответы без новых полей.
 */
const DETAILS_KEY_VERSION = 'v3'
// v2: съёмочная группа сериала и создатели; v3: жанры, студии и keywords;
// v4: франшиза фильма
const EXTRAS_KEY_VERSION = 'v4'
const PERSON_KEY_VERSION = 'v1'

// У части тайтлов нет перевода описания: его берём с английской версии
const FALLBACK_LANGUAGE = 'en-US'

export interface CatalogSearch {
  items: Card[]
  people: Person[]
}

/**
 * TMDB различает «е» и «ё», а названия в нём записаны то так, то так:
 * «зеленая миля» не находит «Зелёную милю», «ёлки» и «елки» — разные фильмы.
 * Запрос с «ё» ищем ещё и через «е». В запросе с «е» не угадать, где была
 * «ё», поэтому пробуем «ё» по очереди на месте каждой из первых «е»: обычно
 * в названии она одна.
 */
export function yoVariants(query: string): string[] {
  if (query.includes('ё'))
    return [query, query.replaceAll('ё', 'е')]

  const variants = [query]

  for (
    let at = query.indexOf('е');
    at !== -1 && variants.length <= MAX_YO_GUESSES;
    at = query.indexOf('е', at + 1)
  ) {
    variants.push(`${query.slice(0, at)}ё${query.slice(at + 1)}`)
  }

  return variants
}

function searchMulti(query: string, language: string) {
  return withMetaCache(`tmdb:search:${language}:${query}`, SEARCH_TTL_MS, () =>
    tmdbGet<TmdbSearchResponse>('/search/multi', {
      query,
      language,
      include_adult: 'false',
    }))
}

/** Результаты вариантов вперемешку, чтобы ни один не вытеснил остальные. */
function interleaveResults(lists: TmdbMultiResult[][]): TmdbMultiResult[] {
  const seen = new Set<string>()
  const merged: TmdbMultiResult[] = []
  const longest = Math.max(...lists.map(list => list.length))

  for (let index = 0; index < longest; index++) {
    for (const list of lists) {
      const result = list[index]

      if (!result)
        continue

      const key = `${result.media_type}:${result.id}`

      if (seen.has(key))
        continue

      seen.add(key)
      merged.push(result)
    }
  }

  return merged.slice(0, SEARCH_PAGE_SIZE)
}

export async function searchCatalog(
  query: string,
  language: string,
): Promise<CatalogSearch> {
  const [exact, ...guesses] = yoVariants(query.trim().toLowerCase())
  // Ошибка исходного запроса — ошибка поиска; догадки только дополняют его
  const [response, ...settled] = await Promise.all([
    searchMulti(exact!, language),
    ...guesses.map(guess =>
      searchMulti(guess, language).then(
        guessed => guessed.results,
        () => [],
      ),
    ),
  ])
  const results = interleaveResults([response.results, ...settled])

  return {
    items: await withRatings(searchResultsToCards(results)),
    people: searchResultsToPeople(results),
  }
}

export async function getTrending(language: string): Promise<Card[]> {
  return withRatings(
    (await getTrendingCards(language)).slice(0, TRENDING_LIMIT),
  )
}

// Логотипы, возрастной рейтинг и IMDb ID приходят вместе с деталями одним
// запросом; у фильма IMDb ID есть в самих деталях
function detailsParams(ref: TmdbRef, language: string) {
  const iso = language.slice(0, 2)
  const imageLanguages = iso === 'en' ? 'en,null' : `${iso},null,en`
  const append
    = ref.type === 'movie' ? 'release_dates' : 'content_ratings,external_ids'

  return {
    language,
    append_to_response: `images,${append}`,
    include_image_language: imageLanguages,
  }
}

interface LoadedTitle {
  details: TitleDetails
  // Только у сериала
  airing?: ReturnType<typeof tvAiring>
  imdbId?: string | null
}

function detailsKey(ref: TmdbRef, language: string) {
  return `tmdb:${ref.type}:${ref.tmdbId}:${language}:${DETAILS_KEY_VERSION}`
}

async function loadTitle(ref: TmdbRef, language: string): Promise<LoadedTitle> {
  const key = detailsKey(ref, language)
  const params = detailsParams(ref, language)

  if (ref.type === 'movie') {
    const movie = await withMetaCache(key, DETAILS_TTL_MS, () =>
      tmdbGet<TmdbMovie>(`/movie/${ref.tmdbId}`, params))

    rememberImdbIdIfChanged(ref, movie.imdb_id)

    return { details: movieToDetails(movie, language), imdbId: movie.imdb_id }
  }

  const tv = await withMetaCache(key, DETAILS_TTL_MS, () =>
    tmdbGet<TmdbTv>(`/tv/${ref.tmdbId}`, params))

  rememberImdbIdIfChanged(ref, tv.external_ids?.imdb_id)

  return {
    details: tvToDetails(tv, language),
    airing: tvAiring(tv),
    imdbId: tv.external_ids?.imdb_id,
  }
}

/** Сериал с сериями с трекера: их TMDB ещё не знает, а раздачи уже есть */
function withTracker(title: LoadedTitle): LoadedTitle {
  return title.airing
    ? withTrackerEpisodes(title, trackerEpisodesOf(title.details.id))
    : title
}

/**
 * Детали и, у сериала, последняя вышедшая и следующая серии — из той же записи
 * кэша, что и карточка. Описание на запасном языке не добирается: это для
 * списков и статуса, не для первого экрана.
 */
export async function getTitleSummary(id: string, language: string) {
  const ref = parseCatalogId(id)

  return ref ? withTracker(await loadTitle(ref, language)) : undefined
}

/** `undefined` — ID не из каталога; отсутствие тайтла в TMDB — `TmdbError`. */
export async function getTitle(
  id: string,
  language: string,
): Promise<TitleDetails | undefined> {
  const ref = parseCatalogId(id)

  if (!ref)
    return undefined

  const { details, imdbId } = withTracker(await loadTitle(ref, language))

  if (!details.overview && language !== FALLBACK_LANGUAGE) {
    try {
      details.overview = (
        await loadTitle(ref, FALLBACK_LANGUAGE)
      ).details.overview
    }
    catch {
      // Без описания карточка всё равно полезна
    }
  }

  const tmdb = details.ratings.find(
    rating => rating.provider === TMDB_PROVIDER,
  )

  details.ratings = await ratingsOf({
    key: details.id,
    kind: details.kind,
    tmdbId: ref.tmdbId,
    imdbId: imdbId || undefined,
    title: details.title,
    originalTitle: details.originalTitle,
    year: details.year,
    tmdbVote: tmdb && { value: tmdb.value, votes: tmdb.votes },
  })

  return details
}

function seasonKey(tmdbId: number, number: number, language: string) {
  return `tmdb:tv:${tmdbId}:season:${number}:${language}`
}

function loadSeason(tmdbId: number, number: number, language: string) {
  return withMetaCache(seasonKey(tmdbId, number, language), SEASON_TTL_MS, () =>
    tmdbGet<TmdbSeason>(`/tv/${tmdbId}/season/${number}`, { language }))
}

/** Языки, на которых детали сериала лежат в кэше; нет ни одного — английский */
function cachedLanguages(ref: TmdbRef) {
  const prefix = `tmdb:${ref.type}:${ref.tmdbId}:`
  const languages = metaCacheKeys(`${prefix}%:${DETAILS_KEY_VERSION}`)
    .map(key => key.slice(prefix.length).split(':')[0])
    .filter(language => /^[a-z]{2}-[A-Z]{2}$/.test(language))

  return languages.length ? [...new Set(languages)] : [FALLBACK_LANGUAGE]
}

/**
 * Серий в сезонах по одному TMDB, без серий с трекера: из деталей в кэше на
 * любом языке. `undefined` — ID не сериала; ошибки TMDB — `TmdbError`.
 */
export async function tmdbEpisodeCounts(id: string) {
  const ref = parseCatalogId(id)

  if (ref?.type !== 'tv')
    return undefined

  const { details } = await loadTitle(ref, cachedLanguages(ref)[0]!)

  return new Map(
    (details.seasons ?? []).map(season => [
      season.number,
      season.episodeCount,
    ]),
  )
}

/** Релиз фильма по TMDB: тип (`TmdbRelease.type`) и дата `YYYY-MM-DD` */
export interface MovieRelease {
  type: number
  date: string
}

/**
 * Даты релизов фильма во всех странах и основная дата выхода — из тех же
 * деталей, что карточка (`release_dates` приходят с ними), на любом языке в
 * кэше. `undefined` — ID не фильма; ошибки TMDB — `TmdbError`.
 */
export async function getMovieReleases(id: string) {
  const ref = parseCatalogId(id)

  if (ref?.type !== 'movie')
    return undefined

  const language = cachedLanguages(ref)[0]!
  const movie = await withMetaCache(
    detailsKey(ref, language),
    DETAILS_TTL_MS,
    () =>
      tmdbGet<TmdbMovie>(`/movie/${ref.tmdbId}`, detailsParams(ref, language)),
  )
  const releases: MovieRelease[] = []

  for (const country of movie.release_dates?.results ?? []) {
    for (const release of country.release_dates) {
      const date = release.release_date?.slice(0, 10)

      if (
        release.type !== undefined
        && date
        && /^\d{4}-\d{2}-\d{2}$/.test(date)
      ) {
        releases.push({ type: release.type, date })
      }
    }
  }

  return { releaseDate: movie.release_date || undefined, releases }
}

/** Эфир сериала из деталей в кэше на любом языке, без запроса в сеть */
export function cachedTvAiring(id: string) {
  const ref = parseCatalogId(id)

  if (ref?.type !== 'tv')
    return undefined

  for (const language of cachedLanguages(ref)) {
    const tv = readMetaCache<TmdbTv>(detailsKey(ref, language))

    if (tv)
      return tvAiring(tv)
  }

  return undefined
}

/**
 * Перезагружает детали сериала мимо срока кэша на всех языках, на которых
 * они лежат в кэше, а с `seasons` — и сезоны последней вышедшей и следующей
 * серий: расписание «Следить» свежее общего кэша. Ответ — эфир из последних
 * деталей; `undefined` — ID не сериала.
 */
export async function refreshTvSchedule(
  id: string,
  options: { seasons: boolean },
) {
  const ref = parseCatalogId(id)

  if (ref?.type !== 'tv')
    return undefined

  let airing: ReturnType<typeof tvAiring> | undefined

  for (const language of cachedLanguages(ref)) {
    const tv = await tmdbGet<TmdbTv>(
      `/tv/${ref.tmdbId}`,
      detailsParams(ref, language),
    )

    storeMetaCache(detailsKey(ref, language), tv)
    airing = tvAiring(tv)

    if (!options.seasons)
      continue

    const seasons = new Set(
      [airing.last?.season, airing.next?.season].filter(
        (number): number is number => number !== undefined && number > 0,
      ),
    )

    for (const number of seasons) {
      storeMetaCache(
        seasonKey(ref.tmdbId, number, language),
        await tmdbGet<TmdbSeason>(`/tv/${ref.tmdbId}/season/${number}`, {
          language,
        }),
      )
    }
  }

  return airing
}

/**
 * ID сериалов TMDB, изменившихся с `startDate` по `endDate` (`YYYY-MM-DD`,
 * не больше 14 дней). `undefined` — страниц больше `maxPages`: изменилось
 * слишком много, проще считать изменившимся всё.
 */
export async function changedTvIds(
  startDate: string,
  endDate: string,
  maxPages: number,
) {
  const ids = new Set<number>()

  for (let page = 1; ; page++) {
    const response = await tmdbGet<TmdbChanges>('/tv/changes', {
      start_date: startDate,
      end_date: endDate,
      page: String(page),
    })

    for (const item of response.results) ids.add(item.id)

    if (page >= response.total_pages)
      return ids

    if (page >= maxPages)
      return undefined
  }
}

/**
 * Сезон с сериями с трекера в конце. `undefined` — ID не сериала из каталога;
 * нет сезона ни в TMDB, ни на трекере — `TmdbError`.
 */
export async function getSeason(
  id: string,
  number: number,
  language: string,
): Promise<SeasonDetails | undefined> {
  const ref = parseCatalogId(id)

  if (ref?.type !== 'tv')
    return undefined

  const tracker = trackerEpisodesOf(id).filter(
    item => item.season === number,
  )

  if (!tracker.length)
    return tmdbSeason(ref.tmdbId, number, language)

  // Сезона, который знают только раздачи, в TMDB не спрашиваем
  const { details } = await loadTitle(ref, language)
  const seasons = details.seasons ?? []
  const known = seasons.find(season => season.number === number)

  return known
    ? withTrackerSeason(
        await tmdbSeason(ref.tmdbId, number, language),
        known.episodeCount,
        tracker,
      )
    : withTrackerSeason(
        { number, name: trackerSeasonName(number, seasons), episodes: [] },
        0,
        tracker,
      )
}

/** Сезон по TMDB: описания серий без перевода — с английской версии */
async function tmdbSeason(tmdbId: number, number: number, language: string) {
  const season = seasonToDetails(await loadSeason(tmdbId, number, language))
  const missing = season.episodes.some(episode => !episode.overview)

  if (missing && language !== FALLBACK_LANGUAGE) {
    try {
      const fallback = seasonToDetails(
        await loadSeason(tmdbId, number, FALLBACK_LANGUAGE),
      )
      const overviews = new Map(
        fallback.episodes.map(episode => [episode.number, episode.overview]),
      )

      for (const episode of season.episodes)
        episode.overview ||= overviews.get(episode.number) ?? ''
    }
    catch {
      // Серии без описания всё равно полезны
    }
  }

  return season
}

/**
 * `watched` — тайтлы, по которым у профиля есть прогресс: отметки на частях
 * франшизы. `undefined` — ID не из каталога; нет тайтла в TMDB — `TmdbError`.
 */
export async function getTitleExtras(
  id: string,
  language: string,
  watched: (titleIds: string[]) => Set<string>,
): Promise<TitleExtras | undefined> {
  const ref = parseCatalogId(id)

  if (!ref)
    return undefined

  const credits = ref.type === 'movie' ? 'credits' : 'aggregate_credits'
  const extras = await withMetaCache(
    `tmdb:${ref.type}:${ref.tmdbId}:${language}:extras:${EXTRAS_KEY_VERSION}`,
    DETAILS_TTL_MS,
    async () =>
      trimExtras(
        await tmdbGet<TmdbExtras>(`/${ref.type}/${ref.tmdbId}`, {
          language,
          append_to_response: `${credits},recommendations,alternative_titles,keywords`,
        }),
      ),
  )
  const dto = extrasToDto(extras, ref, language)

  const collection = extras.belongs_to_collection

  if (ref.type === 'movie' && collection) {
    try {
      const response = await withMetaCache(
        `tmdb:collection:${collection.id}:${language}`,
        DETAILS_TTL_MS,
        () =>
          tmdbGet<TmdbCollection>(`/collection/${collection.id}`, { language }),
      )

      dto.franchise = franchiseParts(response.parts, ref)
    }
    catch {
      // Без частей франшизы карточка всё равно полезна
    }
  }

  // Части франшизы — своим рядом выше: в «Похожем» они бы повторились
  const inFranchise = new Set(dto.franchise.map(part => part.id))
  const notInFranchise = (cards: Card[]) =>
    cards.filter(card => !inFranchise.has(card.id))

  dto.similar = notInFranchise(dto.similar)

  if (dto.similar.length === 0) {
    try {
      const similar = await withMetaCache(
        `tmdb:${ref.type}:${ref.tmdbId}:${language}:similar`,
        DETAILS_TTL_MS,
        () =>
          tmdbGet<TmdbListResponse>(`/${ref.type}/${ref.tmdbId}/similar`, {
            language,
          }),
      )

      dto.similar = notInFranchise(similarCards(similar.results, ref))
    }
    catch {
      // Без «Похожего» карточка всё равно полезна
    }
  }

  const seen = watched(dto.franchise.map(part => part.id))

  for (const part of dto.franchise) part.watched = seen.has(part.id)

  await withRatings([...dto.similar, ...dto.franchise])

  return dto
}

function loadPerson(tmdbId: number, language: string, withCredits: boolean) {
  const kind = withCredits ? 'credits' : 'bio'

  return withMetaCache(
    `tmdb:person:${tmdbId}:${language}:${kind}:${PERSON_KEY_VERSION}`,
    DETAILS_TTL_MS,
    async () =>
      trimPerson(
        await tmdbGet<TmdbPerson>(`/person/${tmdbId}`, {
          language,
          ...(withCredits && { append_to_response: 'combined_credits' }),
        }),
      ),
  )
}

/**
 * Персона и фильмография по ролям. `watched` — тайтлы, по которым у профиля
 * есть прогресс. `undefined` — ID не персоны TMDB; нет персоны — `TmdbError`.
 */
export async function getPerson(
  id: string,
  language: string,
  watched: (titleIds: string[]) => Set<string>,
): Promise<PersonDetails | undefined> {
  const tmdbId = parsePersonId(id)

  if (tmdbId === undefined)
    return undefined

  const person = personToDto(await loadPerson(tmdbId, language, true))

  if (!person.biography && language !== FALLBACK_LANGUAGE) {
    try {
      person.biography = (
        await loadPerson(tmdbId, FALLBACK_LANGUAGE, false)
      ).biography.trim()
    }
    catch {
      // Без биографии страница персоны всё равно полезна
    }
  }

  const items = person.credits.flatMap(group => group.items)
  const seen = watched(items.map(item => item.id))

  await withRatings(items)

  for (const group of person.credits) {
    for (const item of group.items) item.watched = seen.has(item.id)
  }

  return person
}
