import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { createApp } from '../app.ts'
import {
  ACCESS_TOKEN_COOKIE,
  config,
  DEVICE_TOKEN_COOKIE,
  PROFILE_COOKIE,
} from '../config.ts'
import { getDb, migrateDb } from '../db/index.ts'
import {
  devices,
  diaryEntries,
  diarySeen,
  metaCache,
  mineTitlePreferences,
  profiles,
  profileTitles,
  rewatchCycles,
  titleProgress,
  users,
} from '../db/schema.ts'
import { calendarDayAt, DAY_MS } from '../services/mine/calendar.ts'
import { recommendationSignals } from '../services/mine/recommendationSignals.ts'
import { storeMetaCache } from '../services/tmdb/cache.ts'
import { tmdbGet } from '../services/tmdb/client.ts'
import { parseCatalogId } from '../services/tmdb/mappers.ts'
import {
  recommendationDetails,
  recommendationDiscover,
  recommendationGenres,
  recommendationList,
  recommendationSeason,
} from '../services/tmdb/recommendations.ts'
import { ensureDiaryTimeZone } from '../services/transfer/diaryTimeZone.ts'
import { signToken } from '../utils/token.ts'

const app = createApp()
const owner = { [ACCESS_TOKEN_COOKIE]: signToken('owner', 'user_access') }
const movie = (id: number) => `tmdb:movie:${id}`
const series = (id: number) => `tmdb:tv:${id}`
const language = 'en-US'
const fixedDate = new Date('2024-11-02T12:30:00Z')
const fetchMock = vi.fn<typeof fetch>()
let profileId: string

function newProfile(ageLimit: number | null = null) {
  return getDb()
    .insert(profiles)
    .values({ name: 'Viewer', color: 'blue', ageLimit })
    .returning()
    .get()
}

beforeAll(async () => {
  expect(config.databasePath).toBe(':memory:')
  await migrateDb()
  getDb()
    .insert(users)
    .values({ id: 'owner', username: 'Owner', passwordHash: 'fixture' })
    .run()
  ensureDiaryTimeZone('UTC')
  await app.ready()
})

beforeEach(() => {
  const db = getDb()
  for (const table of [devices, profiles, metaCache]) db.delete(table).run()
  profileId = newProfile().id
  vi.stubEnv('TMDB_ACCESS_TOKEN', 'synthetic-test-key')
  fetchMock
    .mockReset()
    .mockRejectedValue(new Error('Unexpected external request'))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

afterAll(async () => {
  await app.close()
})

function request(
  id = profileId,
  query: Record<string, string> = {},
  cookies?: Record<string, string>,
) {
  return app.inject({
    url: '/api/mine/v1/recommendations',
    query: { expectedProfileId: id, language, refresh: 'poll', ...query },
    cookies: cookies ?? { ...owner, [PROFILE_COOKIE]: id },
  })
}

async function read(id = profileId, query: Record<string, string> = {}) {
  const response = await request(id, query)
  expect(response.statusCode, response.body).toBe(200)
  return response.json()
}

function setMine(
  titleId: string,
  data: {
    rating?: number
    favoriteAt?: Date
    watchlistAt?: Date
    droppedAt?: Date
  },
  id = profileId,
) {
  getDb()
    .insert(profileTitles)
    .values({ profileId: id, titleId, ratedAt: fixedDate, ...data })
    .onConflictDoUpdate({
      target: [profileTitles.profileId, profileTitles.titleId],
      set: data,
    })
    .run()
}

function movieRaw(
  id: number,
  runtime: number | null = 100,
  genre = 18,
  age = '6+',
) {
  return {
    id,
    title: `Fixture film ${id}`,
    original_title: `Fixture film ${id}`,
    release_date: '2024-01-03',
    vote_average: 7.6,
    vote_count: 80,
    poster_path: '/film.jpg',
    backdrop_path: '/film-bg.jpg',
    runtime,
    status: 'Released',
    genres: [{ id: genre, name: genre === 18 ? 'Drama' : 'Adventure' }],
    genre_ids: [genre],
    release_dates: {
      results: [{ iso_3166_1: 'RU', release_dates: [{ certification: age }] }],
    },
  }
}

function tvRaw(id: number, air = '2024-01-03') {
  return {
    id,
    name: `Fixture series ${id}`,
    original_name: `Fixture series ${id}`,
    first_air_date: air,
    vote_average: 7.6,
    vote_count: 80,
    status: 'Ended',
    genres: [{ id: 18, name: 'Drama' }],
    genre_ids: [18],
    episode_run_time: [45],
    seasons: [
      { season_number: 0, episode_count: 1, air_date: '2024-01-01' },
      {
        season_number: 1,
        episode_count: 2,
        air_date: air,
      },
    ],
    content_ratings: { results: [{ iso_3166_1: 'RU', rating: '6+' }] },
  }
}

function showMovie(id: number, raw: object = movieRaw(id), locale = language) {
  storeMetaCache(
    recommendationDetails(parseCatalogId(movie(id))!, locale).key,
    raw,
  )
}

function showSeries(id: number, duration: number | null, locale = language) {
  const ref = parseCatalogId(series(id))!
  storeMetaCache(recommendationDetails(ref, locale).key, tvRaw(id))
  storeMetaCache(recommendationSeason(ref, 1, locale).key, {
    episodes: [
      {
        episode_number: 2,
        name: 'Later episode',
        air_date: '2024-01-06',
        runtime: 45,
      },
      {
        episode_number: 1,
        name: 'First regular episode',
        air_date: '2024-01-03',
        runtime: duration,
      },
    ],
  })
}

function showGenres(locale = language) {
  storeMetaCache(recommendationGenres('movie', locale).key, {
    genres: [
      { id: 18, name: 'Drama' },
      { id: 12, name: 'Adventure' },
    ],
  })
  storeMetaCache(recommendationGenres('tv', locale).key, {
    genres: [{ id: 18, name: 'Drama' }],
  })
}

function listFor(seed: string, results: object[], locale = language) {
  const key = recommendationList(parseCatalogId(seed)!, locale).key
  storeMetaCache(key, { results })
  return key
}

function movieList(ids: number[]) {
  return ids.map(id => ({ ...movieRaw(id), media_type: 'movie' }))
}

function response(
  value: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function requestedPaths() {
  return fetchMock.mock.calls.map(([input]) => new URL(String(input)).pathname)
}

function ids(result: { items: Array<{ card: { id: string } }> }) {
  return result.items.map(item => item.card.id)
}

async function settled(id = profileId, query: Record<string, string> = {}) {
  let result
  await vi.waitFor(async () => {
    result = await read(id, query)
    expect(result.refresh.state).not.toBe('pending')
  })
  return result!
}

describe('live recommendations', () => {
  it('deduplicates independent seed lists and immediately applies feedback with unchanged timestamps', async () => {
    const seed = movie(91)
    const other = movie(92)
    for (const id of [91, 92, 201, 202, 203, 204, 205]) showMovie(id)
    showGenres()
    setMine(seed, { rating: 9 })
    setMine(other, { rating: 8 })
    listFor(seed, movieList([201, 202, 201, 204, 205]))
    listFor(other, movieList([201, 203]))
    setMine(movie(204), { droppedAt: fixedDate })
    setMine(movie(205), { rating: 4 })
    const initial = await read(profileId, { refresh: 'visible' })
    expect(ids(initial)).toEqual([movie(201), movie(202), movie(203)])
    expect(initial).toMatchObject({
      hasPersonalSignals: true,
      items: [
        expect.objectContaining({
          reason: {
            kind: 'ratedSeed',
            titleId: seed,
            title: 'Fixture film 91',
            rating: 9,
          },
        }),
        expect.anything(),
        expect.anything(),
      ],
      refresh: { state: 'idle' },
    })
    expect(fetchMock).not.toHaveBeenCalled()

    const patch = (values: object) =>
      app.inject({
        method: 'PATCH',
        url: `/api/mine/v1/title/${movie(201)}`,
        cookies: owner,
        payload: { expectedProfileId: profileId, language, ...values },
      })
    expect(
      (await patch({ note: 'Private note', continuation: 'hidden' }))
        .statusCode,
    ).toBe(200)
    expect((await patch({ notInterested: true })).json()).toMatchObject({
      notInterested: true,
      note: 'Private note',
      continuation: 'hidden',
    })
    expect(ids(await read())).toEqual([movie(202), movie(203)])
    const hidden = await app.inject({
      url: '/api/mine/v1/recommendation-exclusions',
      query: { expectedProfileId: profileId },
      cookies: owner,
    })
    expect(hidden.json()).toMatchObject({
      total: 1,
      items: [{ id: movie(201) }],
    })
    expect((await patch({ notInterested: false })).json()).toMatchObject({
      notInterested: false,
      note: 'Private note',
      continuation: 'hidden',
    })
    expect(ids(await read())[0]).toBe(movie(201))
    setMine(seed, { rating: 4 })
    expect(ids(await read())).toEqual([movie(201), movie(203)])
    expect((await read()).items[0].reason).toMatchObject({
      kind: 'ratedSeed',
      titleId: other,
      rating: 8,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps the personal seen projection independent from historical entries and excludes active cycles', async () => {
    const seed = movie(93)
    showMovie(93)
    setMine(seed, { rating: 10 })
    listFor(seed, movieList([210, 211, 212]))
    const inProgress = movie(211)
    getDb()
      .insert(titleProgress)
      .values({
        profileId,
        titleId: inProgress,
        season: 0,
        episode: 0,
        position: 100,
        updatedAt: fixedDate,
      })
      .run()
    const titleId = movie(210)
    getDb()
      .insert(diaryEntries)
      .values({
        profileId,
        titleId,
        season: 0,
        episode: 0,
        precision: 'day',
        day: '2024-06-01',
        origin: 'manual',
        createdAt: fixedDate,
        updatedAt: fixedDate,
      })
      .run()
    getDb()
      .insert(diarySeen)
      .values({ profileId, titleId, season: 0, episode: 0 })
      .run()
    const tv = series(921)
    const tvSeed = series(920)
    setMine(tvSeed, { favoriteAt: fixedDate })
    listFor(tvSeed, [tvRaw(921)])
    getDb()
      .insert(rewatchCycles)
      .values({
        profileId,
        titleId: tv,
        state: 'paused',
        startSeason: 1,
        startEpisode: 1,
        targetSeason: 1,
        targetEpisode: 1,
        createdAt: fixedDate,
        updatedAt: fixedDate,
      })
      .run()
    expect(ids(await read())).toEqual([movie(212)])

    const unwatch = await app.inject({
      method: 'PUT',
      url: `/api/mine/v1/title/${titleId}/seen`,
      cookies: owner,
      payload: {
        expectedProfileId: profileId,
        language,
        season: 0,
        episode: 0,
        watched: false,
      },
    })
    expect(unwatch.statusCode, unwatch.body).toBe(200)
    expect(ids(await read())).toEqual([titleId, movie(212)])
    expect(getDb().select().from(diaryEntries).all()).toHaveLength(1)
  })

  it('selects only exact runtimes, filters before truncation and keeps watchlist offline', async () => {
    for (let i = 0; i < 15; i++) {
      setMine(movie(500 + i), {
        watchlistAt: new Date(fixedDate.getTime() + i * 1000),
      })
    }
    showMovie(250, movieRaw(250, 120))
    showMovie(251, movieRaw(251, 121))
    showMovie(252, {
      ...movieRaw(252),
      release_date: '9999-01-01',
      status: 'Planned',
    })
    showSeries(320, 125)
    showSeries(321, null)
    showSeries(322, 115)
    for (const titleId of [
      movie(250),
      movie(251),
      movie(252),
      series(320),
      series(321),
      series(322),
    ])
      setMine(titleId, { watchlistAt: new Date('2024-03-03T12:00:00Z') })

    const strict = await read(profileId, {
      source: 'watchlist',
      maxMinutes: '120',
      refresh: 'visible',
      genre: '18',
    })
    expect(ids(strict)).toEqual([movie(250), series(322)])
    expect(strict.items).toMatchObject([
      {
        runtimeMinutes: 120,
        reason: { kind: 'watchlistSince', day: '2024-03-03' },
      },
      { runtimeMinutes: 115, episode: { season: 1, episode: 1 } },
    ])
    const any = await read(profileId, {
      source: 'watchlist',
      kind: 'series',
      refresh: 'visible',
    })
    expect(any.items).toMatchObject([
      { card: { id: series(320) }, runtimeMinutes: 125 },
      { card: { id: series(321) }, runtimeMinutes: null },
      { card: { id: series(322) }, runtimeMinutes: 115 },
    ])
    const withoutArt = await read(profileId, {
      source: 'watchlist',
      kind: 'movie',
      refresh: 'visible',
    })
    expect(withoutArt.items[0].card.title).toBe(movie(514))
    expect(withoutArt.items[0].card).not.toHaveProperty('poster')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('supports cold Discover reasons, public genres, and new-versus-both scope', async () => {
    const today = calendarDayAt(Date.now(), 'UTC')
    const cold = recommendationDiscover('movie', language, today, 18)
    const results = movieList([301, 302, 303])
    storeMetaCache(cold.key, { results })
    showGenres()
    setMine(movie(301), { watchlistAt: fixedDate })
    getDb()
      .insert(mineTitlePreferences)
      .values({
        profileId,
        titleId: movie(303),
        notInterested: true,
        updatedAt: fixedDate,
      })
      .run()
    const onlyNew = await read(profileId, {
      source: 'new',
      kind: 'movie',
      genre: '18',
    })
    expect(ids(onlyNew)).toEqual([movie(302)])
    expect(onlyNew).toMatchObject({
      hasPersonalSignals: false,
      genres: [
        { id: 12, name: 'Adventure' },
        { id: 18, name: 'Drama' },
      ],
      items: [
        { reason: { kind: 'selectedGenre', genre: { id: 18, name: 'Drama' } } },
      ],
    })
    const both = await read(profileId, { kind: 'movie', genre: '18' })
    expect(ids(both)).toEqual([movie(301), movie(302)])
    expect(both.items[0].reason).toEqual({
      kind: 'watchlistSince',
      day: '2024-11-02',
    })
    storeMetaCache(recommendationDiscover('movie', language, today).key, {
      results,
    })
    expect(
      (await read(profileId, { source: 'new', kind: 'movie' })).items[0].reason,
    ).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps an old favorite as a seed and caps repeated episodes at a single signal', async () => {
    const show = series(4321)
    for (let ep = 1; ep <= 100; ep++) {
      getDb()
        .insert(diaryEntries)
        .values({
          profileId,
          titleId: show,
          season: 2,
          episode: ep,
          precision: 'day',
          day: '2024-11-01',
          origin: 'manual',
          createdAt: fixedDate,
          updatedAt: fixedDate,
        })
        .run()
    }
    for (const day of [7, 8]) {
      getDb()
        .insert(diaryEntries)
        .values({
          profileId,
          titleId: show,
          season: 2,
          episode: 1,
          precision: 'instant',
          instant: new Date(Date.UTC(2024, 10, day)),
          origin: 'trakt',
          originKey: `id:${day}`,
          rewatch: false,
          createdAt: fixedDate,
          updatedAt: fixedDate,
        })
        .run()
    }
    const favorite = movie(94)
    setMine(favorite, { favoriteAt: fixedDate })
    listFor(favorite, movieList([305]))
    const result = await read()
    expect(result).toMatchObject({
      hasPersonalSignals: true,
      items: [{ card: { id: movie(305) }, reason: null }],
    })
    const seeds = recommendationSignals(
      getDb().select().from(profiles).where(eq(profiles.id, profileId)).get()!,
      language,
      'UTC',
      Date.now(),
    ).seeds
    expect(seeds).toMatchObject([{ id: favorite }, { id: show, strength: 58 }])
    showMovie(94)
    expect((await read()).items[0].reason).toEqual({
      kind: 'favoriteSeed',
      titleId: favorite,
      title: 'Fixture film 94',
    })
    getDb()
      .update(profileTitles)
      .set({ favoriteAt: null })
      .where(eq(profileTitles.titleId, favorite))
      .run()
    expect((await read()).items).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses only an accessible source title in favorite and watched reasons', async () => {
    showMovie(4181, movieRaw(4181, 100, 18, '18+'))
    showMovie(4182)
    showMovie(4183)
    setMine(movie(4181), { favoriteAt: fixedDate })
    getDb()
      .insert(diarySeen)
      .values({ profileId, titleId: movie(4182), season: 0, episode: 0 })
      .run()
    listFor(movie(4181), movieList([4183]))
    listFor(movie(4182), movieList([4183]))
    expect((await read()).items[0].reason).toEqual({
      kind: 'favoriteSeed',
      titleId: movie(4181),
      title: 'Fixture film 4181',
    })
    getDb()
      .update(profiles)
      .set({ ageLimit: 12 })
      .where(eq(profiles.id, profileId))
      .run()
    expect((await read()).items[0].reason).toEqual({
      kind: 'watchedSeed',
      titleId: movie(4182),
      title: 'Fixture film 4182',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('applies cached age proof before exclusion counts, pagination and personal reasons', async () => {
    const limit = 12
    getDb()
      .update(profiles)
      .set({ ageLimit: limit })
      .where(eq(profiles.id, profileId))
      .run()
    const seed = movie(96)
    setMine(seed, { rating: 10 })
    showMovie(96)
    listFor(seed, movieList([306, 307, 308]))
    showMovie(306)
    showMovie(307, movieRaw(307, 100, 18, '16+'))
    expect(ids(await read())).toEqual([movie(306)])
    for (const id of [306, 307, 308]) {
      getDb()
        .insert(mineTitlePreferences)
        .values({
          profileId,
          titleId: movie(id),
          notInterested: true,
          updatedAt: new Date(id),
        })
        .run()
    }
    const list = await app.inject({
      url: '/api/mine/v1/recommendation-exclusions',
      query: { expectedProfileId: profileId, limit: '1' },
      cookies: owner,
    })
    expect(list.json()).toMatchObject({
      total: 1,
      items: [{ id: movie(306) }],
    })
    const foreign = await request(
      newProfile().id,
      { refresh: 'visible' },
      owner,
    )
    expect(foreign.statusCode, foreign.body).toBe(409)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('treats an undated manual viewing as weak evidence and ignores merely creating a cycle', async () => {
    const titleId = movie(4101)
    const result = await app.inject({
      method: 'POST',
      url: '/api/mine/v1/diary',
      cookies: owner,
      payload: {
        requestId: 'c424499a-62be-4181-9005-07f038dd41ac',
        expectedProfileId: profileId,
        language,
        target: { titleId, season: 0, episode: 0 },
        date: { precision: 'unknown' },
      },
    })
    expect(result.statusCode, result.body).toBe(200)
    expect(result.json()).toMatchObject({
      entry: { calendarDay: null, rewatch: false },
    })
    // Logging may load this title's metadata, but must not refresh recommendation candidates.
    expect(requestedPaths()).toEqual(['/3/movie/4101'])
    getDb()
      .insert(rewatchCycles)
      .values({
        profileId,
        titleId: series(4102),
        state: 'active',
        startSeason: 1,
        startEpisode: 1,
        targetSeason: 1,
        targetEpisode: 1,
        createdAt: fixedDate,
        updatedAt: fixedDate,
      })
      .run()
    listFor(titleId, movieList([4103]))
    listFor(series(4102), [tvRaw(4104)])
    expect(await read()).toMatchObject({
      hasPersonalSignals: true,
      items: [{ card: { id: movie(4103) }, reason: null }],
    })
    const profile = getDb()
      .select()
      .from(profiles)
      .where(eq(profiles.id, profileId))
      .get()!
    expect(
      recommendationSignals(profile, language, 'UTC', Date.now()).seeds,
    ).toMatchObject([
      {
        id: titleId,
        strength: 24,
        at: 0,
        rating: null,
        watched: true,
        favorite: false,
      },
    ])
    showMovie(4101)
    expect((await read()).items[0].reason).toEqual({
      kind: 'watchedSeed',
      titleId,
      title: 'Fixture film 4101',
    })
    expect(requestedPaths()).toEqual(['/3/movie/4101'])
  })

  it('admits series seeds before applying the title quota', async () => {
    for (let id = 4110; id < 4122; id++) setMine(movie(id), { rating: 10 })
    const oldSeries = series(4123)
    setMine(oldSeries, { rating: 8 })
    showSeries(4123, 44)
    showSeries(4124, 55)
    showGenres()
    listFor(oldSeries, [tvRaw(4124)])
    const result = await read(profileId, {
      refresh: 'visible',
      kind: 'series',
    })
    expect(result).toMatchObject({
      hasPersonalSignals: true,
      items: [
        {
          card: { id: series(4124) },
          reason: {
            kind: 'ratedSeed',
            titleId: oldSeries,
            title: 'Fixture series 4123',
            rating: 8,
          },
        },
      ],
      refresh: { state: 'idle' },
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps localized public artwork and titles while reusing another locale’s exact runtime', async () => {
    const seed = movie(4131)
    const candidate = movie(4132)
    setMine(seed, { rating: 9 })
    showMovie(4131)
    showMovie(4131, { ...movieRaw(4131), title: 'Сигнал-банк' }, 'ru-RU')
    showMovie(4132, movieRaw(4132, 117))
    showGenres('ru-RU')
    const localized = {
      ...movieRaw(4132),
      title: 'Вечерний сигнал',
      original_title: 'Evening Signal',
      poster_path: '/ru-poster.jpg',
      backdrop_path: '/ru-backdrop.jpg',
    }
    listFor(seed, [localized], 'ru-RU')
    const filters = {
      language: 'ru-RU',
      refresh: 'visible',
      maxMinutes: '120',
    }
    const result = await read(profileId, filters)
    expect(result).toMatchObject({
      items: [
        {
          card: {
            id: candidate,
            title: localized.title,
            originalTitle: localized.original_title,
            poster: expect.stringContaining('/ru-poster.jpg'),
          },
          backdrop: expect.stringContaining('/ru-backdrop.jpg'),
          runtimeMinutes: 117,
          reason: {
            kind: 'ratedSeed',
            titleId: seed,
            title: 'Сигнал-банк',
            rating: 9,
          },
        },
      ],
      refresh: { state: 'idle' },
    })
    expect(fetchMock).not.toHaveBeenCalled()

    showMovie(
      4132,
      {
        ...localized,
        title: 'Сигнал после заката',
        poster_path: '/ru-details.jpg',
        runtime: null,
      },
      'ru-RU',
    )
    const details = await read(profileId, filters)
    expect(details.items).toMatchObject([
      {
        card: {
          title: 'Сигнал после заката',
          poster: expect.stringContaining('/ru-details.jpg'),
        },
        runtimeMinutes: 117,
      },
    ])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('diversifies the top pool with stable genre and franchise penalties', async () => {
    const seed = movie(97)
    setMine(seed, { rating: 9 })
    showMovie(97)
    const films = Array.from({ length: 17 }, (_, i) => 4000 + i)
    listFor(seed, movieList(films))
    for (const [i, id] of films.entries()) {
      const genre = i < 13 ? 18 : 12
      showMovie(id, {
        ...movieRaw(id, 100, genre),
        belongs_to_collection:
          i < 8 ? { id: 100, name: 'Fixture franchise' } : null,
      })
    }
    const first = await read()
    expect(first.items).toHaveLength(12)
    expect(ids(first).slice(0, 4)).toContain(movie(4013))
    expect(ids(first)).toEqual(ids(await read()))
  })
})

describe('lazy and bounded TMDB requests', () => {
  it('returns immediately and spends at most 16 requests including age, genre and exact season', async () => {
    getDb()
      .update(profiles)
      .set({ ageLimit: 12 })
      .where(eq(profiles.id, profileId))
      .run()
    const tv = series(6800)
    const tvCandidate = series(6801)
    setMine(tv, { rating: 10 })
    showSeries(6800, 60)
    for (let id = 6900; id < 6910; id++) {
      setMine(movie(id), { rating: 9 })
      showMovie(id)
    }
    getDb()
      .insert(mineTitlePreferences)
      .values({
        profileId,
        titleId: tv,
        note: 'private fixture note',
        updatedAt: fixedDate,
      })
      .run()
    const release = Promise.withResolvers<void>()
    let active = 0
    let maximum = 0
    fetchMock.mockImplementation(async (input) => {
      const url = new URL(String(input))
      active++
      maximum = Math.max(maximum, active)
      await release.promise
      await new Promise(resolve => setTimeout(resolve, 3))
      active--
      const path = url.pathname
      if (path === '/3/tv/6800/recommendations')
        return response({ results: [tvRaw(6801)] })
      if (path === '/3/tv/6801')
        return response(tvRaw(6801))
      if (path === '/3/tv/6801/season/1') {
        return response({
          episodes: [
            {
              episode_number: 1,
              name: 'First',
              air_date: '2024-03-02',
              runtime: 125,
            },
            {
              episode_number: 2,
              name: 'Second',
              air_date: '2024-03-03',
              runtime: 40,
            },
          ],
        })
      }
      const filmSeed = /^\/3\/movie\/(\d+)\/recommendations$/.exec(path)
      if (filmSeed) {
        return response({
          results: movieList(
            Array.from({ length: 7 }, (_, i) => Number(filmSeed[1]) * 10 + i),
          ),
        })
      }
      const film = /^\/3\/movie\/(\d+)$/.exec(path)
      if (film)
        return response(movieRaw(Number(film[1])))
      if (path.startsWith('/3/genre/'))
        return response({ genres: [{ id: 18, name: 'Drama' }] })
      throw new Error(`Unexpected path ${path}`)
    })
    const filters = { maxMinutes: '120' }
    try {
      const started = await read(profileId, { ...filters, refresh: 'visible' })
      expect(started).toMatchObject({
        items: [],
        refresh: { state: 'pending' },
      })
      await vi.waitFor(() => expect(active).toBe(2))
      const poll = await read(profileId, filters)
      expect(poll.refresh.state).toBe('pending')
      expect(fetchMock).toHaveBeenCalledTimes(2)
    }
    finally {
      release.resolve()
    }
    const result = await settled(profileId, filters)
    expect(result.items.length).toBeGreaterThan(0)
    expect(ids(result)).not.toContain(tvCandidate)
    expect(maximum).toBe(2)
    expect(
      requestedPaths().filter(path => path.endsWith('/recommendations')),
    ).toHaveLength(6)
    expect(
      requestedPaths().filter(path => path.startsWith('/3/genre/')),
    ).toHaveLength(2)
    expect(requestedPaths()).toContain('/3/tv/6801/season/1')
    expect(fetchMock).toHaveBeenCalledTimes(16)
    for (const [input] of fetchMock.mock.calls) {
      const url = new URL(String(input))
      expect(url.origin).toBe('https://api.themoviedb.org')
      expect(url.href).not.toContain(
        encodeURIComponent('private fixture note'),
      )
      expect(url.href).not.toContain(profileId)
    }
    for (let i = 0; i < 3; i++) await read(profileId, filters)
    expect(fetchMock).toHaveBeenCalledTimes(16)
  })

  it('shares in-flight collections and coalesces visible language intents for each profile', async () => {
    const other = newProfile().id
    const seedIds = [movie(701), movie(702)]
    for (const [index, seed] of seedIds.entries()) {
      setMine(seed, { rating: 9 }, profileId)
      setMine(seed, { rating: 9 }, other)
      showMovie(701 + index)
      showMovie(711 + index)
    }
    showGenres()
    showGenres('ru-RU')
    const release = Promise.withResolvers<void>()
    let active = 0
    let maximum = 0
    fetchMock.mockImplementation(async (input) => {
      const url = new URL(String(input))
      active++
      maximum = Math.max(maximum, active)
      await release.promise
      await Promise.resolve()
      active--
      const seed = Number(url.pathname.split('/')[3])
      return response({ results: movieList([seed + 10]) })
    })
    try {
      expect(
        (await read(profileId, { refresh: 'visible' })).refresh.state,
      ).toBe('pending')
      await vi.waitFor(() => expect(active).toBe(2))
      expect((await read(other, { refresh: 'visible' })).refresh.state).toBe(
        'pending',
      )
      expect(
        (await read(other, { refresh: 'visible', language: 'ru-RU' })).refresh
          .state,
      ).toBe('pending')
      expect(
        (await read(other, { refresh: 'poll', language: 'fr-FR' })).refresh
          .state,
      ).toBe('idle')
      expect(fetchMock).toHaveBeenCalledTimes(2)
    }
    finally {
      release.resolve()
    }
    const [first, second] = await Promise.all([
      settled(),
      settled(other, { language: 'ru-RU' }),
    ])
    expect(ids(first)).toEqual(ids(second))
    expect(first.profileId).toBe(profileId)
    expect(second.profileId).toBe(other)
    expect(maximum).toBe(2)
    const calls = fetchMock.mock.calls.map(([input]) => new URL(String(input)))
    expect(
      calls.map(url => [url.pathname, url.searchParams.get('language')]),
    ).toEqual([
      ['/3/movie/701/recommendations', 'en-US'],
      ['/3/movie/702/recommendations', 'en-US'],
      ['/3/movie/701/recommendations', 'ru-RU'],
      ['/3/movie/702/recommendations', 'ru-RU'],
    ])
  })

  it.each(['watchlist', 'fully cached'] as const)(
    'cancels queued network work when the latest visible view is %s',
    async (latest) => {
      const seeds = [4151, 4152, 4153]
      showGenres()
      showGenres('fr-FR')
      for (const id of seeds) {
        setMine(movie(id), { rating: 9 })
        showMovie(id)
        showMovie(id + 10)
        listFor(movie(id), movieList([id + 10]), 'fr-FR')
      }
      const release = Promise.withResolvers<void>()
      let active = 0
      fetchMock.mockImplementation(async (input) => {
        active++
        await release.promise
        active--
        const id = Number(new URL(String(input)).pathname.split('/')[3])
        return response({ results: movieList([id + 10]) })
      })
      try {
        expect(
          (await read(profileId, { refresh: 'visible' })).refresh.state,
        ).toBe('pending')
        await vi.waitFor(() => expect(active).toBe(2))
        expect(
          (await read(profileId, { refresh: 'visible', language: 'ru-RU' }))
            .refresh.state,
        ).toBe('pending')
        const replacement: Record<string, string>
          = latest === 'watchlist'
            ? { source: 'watchlist' }
            : { language: 'fr-FR' }
        expect(
          (await read(profileId, { refresh: 'visible', ...replacement }))
            .refresh.state,
        ).toBe('idle')
        expect(fetchMock).toHaveBeenCalledTimes(2)
      }
      finally {
        release.resolve()
      }
      await vi.waitFor(() => expect(active).toBe(0))
      await read(profileId, { language: 'ru-RU' })
      await read()
      expect(requestedPaths()).toEqual([
        '/3/movie/4151/recommendations',
        '/3/movie/4152/recommendations',
      ])
    },
  )

  it.each(['visible', 'poll'] as const)(
    'only a second visible viewer can take over queued work (%s)',
    async (refresh) => {
      const busyProfile = newProfile().id
      const db = getDb()
      const firstToken = 'two-viewers-fixture-a'
      const secondToken = 'two-viewers-fixture-b'
      const addDevice = (token: string) =>
        db
          .insert(devices)
          .values({
            name: token,
            type: 'tv',
            profileId,
            tokenHash: createHash('sha256').update(token).digest('hex'),
          })
          .returning()
          .get()
      const first = addDevice(firstToken)
      addDevice(secondToken)
      showGenres()
      for (const seed of [4191, 4192]) {
        showMovie(seed)
        setMine(movie(seed), { rating: 9 }, busyProfile)
      }
      showMovie(4193)
      showMovie(4194)
      setMine(movie(4193), { rating: 9 })
      const release = Promise.withResolvers<void>()
      fetchMock.mockImplementation(async (input) => {
        const path = new URL(String(input)).pathname
        if (path === '/3/movie/4193/recommendations')
          return response({ results: movieList([4194]) })
        await release.promise
        return response({ results: [] })
      })
      try {
        expect(
          (await read(busyProfile, { refresh: 'visible' })).refresh.state,
        ).toBe('pending')
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
        const original = await request(
          profileId,
          { refresh: 'visible' },
          { [DEVICE_TOKEN_COOKIE]: firstToken },
        )
        expect(original.json()).toMatchObject({
          profileId,
          refresh: { state: 'pending' },
        })
        db.update(devices)
          .set({ profileId: busyProfile })
          .where(eq(devices.id, first.id))
          .run()
        const forbidden = await request(
          profileId,
          { refresh: 'visible' },
          { [DEVICE_TOKEN_COOKIE]: firstToken },
        )
        expect(forbidden.statusCode).toBe(409)
        const replacement = await request(
          profileId,
          { refresh },
          { [DEVICE_TOKEN_COOKIE]: secondToken },
        )
        expect(replacement.json()).toMatchObject({
          profileId,
          refresh: { state: 'pending' },
        })
        expect(fetchMock).toHaveBeenCalledTimes(2)
      }
      finally {
        release.resolve()
      }

      await settled(busyProfile)
      const result = await settled()
      expect(ids(result)).toEqual(refresh === 'visible' ? [movie(4194)] : [])
      expect(requestedPaths()).toEqual([
        '/3/movie/4191/recommendations',
        '/3/movie/4192/recommendations',
        ...(refresh === 'visible' ? ['/3/movie/4193/recommendations'] : []),
      ])
    },
  )

  it('rechecks age, profile deletion and paired viewer selection before queued starts', async () => {
    const restricted = newProfile().id
    const goingAway = newProfile().id
    const pairedProfile = newProfile().id
    const release = Promise.withResolvers<void>()
    const token = 'synthetic-paired-viewer'
    const device = getDb()
      .insert(devices)
      .values({
        name: 'TV',
        type: 'tv',
        profileId: pairedProfile,
        tokenHash: createHash('sha256').update(token).digest('hex'),
      })
      .returning()
      .get()
    showGenres()
    for (const id of [801, 802]) {
      showMovie(id)
      setMine(movie(id), { rating: 9 })
    }
    for (const [id, profile] of [
      [803, restricted],
      [804, goingAway],
      [805, pairedProfile],
    ] as const) {
      showMovie(id, movieRaw(id, 100, 18, '18+'))
      setMine(movie(id), { rating: 9 }, profile)
    }
    fetchMock.mockImplementation(async () => {
      await release.promise
      return response({ results: [] })
    })
    try {
      expect(
        (await read(profileId, { refresh: 'visible' })).refresh.state,
      ).toBe('pending')
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
      expect(
        (await read(restricted, { refresh: 'visible' })).refresh.state,
      ).toBe('pending')
      expect(
        (await read(goingAway, { refresh: 'visible' })).refresh.state,
      ).toBe('pending')
      const stale = await request(
        pairedProfile,
        { refresh: 'visible' },
        { [DEVICE_TOKEN_COOKIE]: token },
      )
      expect(stale.json()).toMatchObject({
        profileId: pairedProfile,
        refresh: { state: 'pending' },
      })
      getDb()
        .update(profiles)
        .set({ ageLimit: 12 })
        .where(eq(profiles.id, restricted))
        .run()
      getDb().delete(profiles).where(eq(profiles.id, goingAway)).run()
      getDb()
        .update(devices)
        .set({ profileId })
        .where(eq(devices.id, device.id))
        .run()
    }
    finally {
      release.resolve()
    }
    await settled()
    const ageChanged = await settled(restricted)
    expect(ageChanged).toMatchObject({ hasPersonalSignals: false, items: [] })
    expect(requestedPaths()).toEqual([
      '/3/movie/801/recommendations',
      '/3/movie/802/recommendations',
    ])
    expect(
      (await request(pairedProfile, {}, { [DEVICE_TOKEN_COOKIE]: token }))
        .statusCode,
    ).toBe(409)
    expect((await request(goingAway)).statusCode).toBe(409)
  })

  it('skips a 404 seed and still serves a cached watchlist', async () => {
    const old = movie(845)
    showMovie(845)
    showMovie(846)
    showGenres()
    setMine(old, { rating: 9 })
    setMine(movie(846), { watchlistAt: fixedDate })
    const key = listFor(old, movieList([847]))
    getDb()
      .update(metaCache)
      .set({ fetchedAt: new Date(Date.now() - 2 * DAY_MS) })
      .where(eq(metaCache.key, key))
      .run()
    fetchMock.mockResolvedValue(response({}, 404))
    const starting = await read(profileId, { refresh: 'visible' })
    expect(ids(starting)).toEqual([movie(846), movie(847)])
    const finished = await settled()
    expect(ids(finished)).toEqual([movie(846)])
    expect(finished.refresh.state).toBe('idle')
    expect(requestedPaths()).toEqual(['/3/movie/845/recommendations'])
  })

  it('honors 429 even when stale cache catches it, then resumes only on a new visible read', async () => {
    const seed = movie(888)
    showMovie(888)
    showMovie(889)
    showMovie(890)
    showGenres()
    setMine(seed, { rating: 9 })
    const key = listFor(seed, movieList([889]))
    getDb()
      .update(metaCache)
      .set({ fetchedAt: new Date(Date.now() - 2 * DAY_MS) })
      .where(eq(metaCache.key, key))
      .run()
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    fetchMock.mockResolvedValue(response({}, 429, { 'retry-after': '7' }))
    const pending = await read(profileId, { refresh: 'visible' })
    expect(pending.refresh.state).toBe('pending')
    expect(ids(pending)).toEqual([movie(889)])
    const paused = await settled()
    expect(ids(paused)).toEqual([movie(889)])
    expect(paused.refresh).toEqual({ state: 'backoff', retryAfterMs: 7000 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await read(profileId, { refresh: 'visible', genre: '18' })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    clock.mockReturnValue(now + 8000)
    expect((await read()).refresh.state).toBe('idle')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    fetchMock.mockResolvedValue(response({ results: movieList([890]) }))
    expect((await read(profileId, { refresh: 'visible' })).refresh.state).toBe(
      'pending',
    )
    expect(ids(await settled())).toEqual([movie(890)])
    expect(fetchMock).toHaveBeenCalledTimes(2)

    fetchMock.mockResolvedValue(
      response({}, 429, {
        'retry-after': new Date(now + 15_000).toUTCString(),
      }),
    )
    await expect(tmdbGet('/configuration', {})).rejects.toMatchObject({
      kind: 'unavailable',
      upstreamStatus: 429,
      retryAfterMs: Math.floor((now + 15_000) / 1000) * 1000 - now - 8000,
    })
  })

  it.each([false, true])(
    'interrupts pre-429 work after the cooldown expires (queued view %s)',
    async (queued) => {
      const seeds = [4161, 4162, 4163]
      showGenres()
      showGenres('ru-RU')
      for (const id of seeds) {
        setMine(movie(id), { rating: 9 })
        showMovie(id)
        showMovie(id + 10)
      }
      const stale = listFor(movie(4161), movieList([4171]))
      getDb()
        .update(metaCache)
        .set({ fetchedAt: new Date(Date.now() - 2 * DAY_MS) })
        .where(eq(metaCache.key, stale))
        .run()
      const first = Promise.withResolvers<Response>()
      const second = Promise.withResolvers<Response>()
      fetchMock
        .mockImplementationOnce(() => first.promise)
        .mockImplementationOnce(() => second.promise)
        .mockImplementation(async (input) => {
          const id = Number(new URL(String(input)).pathname.split('/')[3])
          return response({ results: movieList([id + 10]) })
        })

      const now = Date.now()
      const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
      try {
        expect(
          (await read(profileId, { refresh: 'visible' })).refresh.state,
        ).toBe('pending')
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
        if (queued) {
          expect(
            (await read(profileId, { refresh: 'visible', language: 'ru-RU' }))
              .refresh.state,
          ).toBe('pending')
        }
        first.resolve(response({}, 429, { 'retry-after': '1' }))
        await vi.waitFor(async () => {
          const paused = await read()
          expect(ids(paused)).toEqual([movie(4171)])
          expect(paused.refresh).toEqual({
            state: 'backoff',
            retryAfterMs: 1000,
          })
        })

        // The slower request remains in flight until after Retry-After ends.
        clock.mockReturnValue(now + 2000)
        expect((await read()).refresh.state).toBe('idle')
        second.resolve(response({ results: movieList([4172]) }))
        await read()
        await read(profileId, { language: 'ru-RU' })
        expect(fetchMock).toHaveBeenCalledTimes(2)

        expect(
          (await read(profileId, { refresh: 'visible' })).refresh.state,
        ).toBe('pending')
        await settled()
        expect(requestedPaths()).toEqual([
          '/3/movie/4161/recommendations',
          '/3/movie/4162/recommendations',
          '/3/movie/4161/recommendations',
          '/3/movie/4163/recommendations',
        ])
        expect(
          fetchMock.mock.calls.every(
            ([input]) =>
              new URL(String(input)).searchParams.get('language') === 'en-US',
          ),
        ).toBe(true)
      }
      finally {
        first.resolve(response({}, 429, { 'retry-after': '1' }))
        second.resolve(response({ results: movieList([4172]) }))
      }
    },
  )

  it('reports missing catalog and shows the local watchlist during a network failure', async () => {
    showMovie(950)
    setMine(movie(950), { watchlistAt: fixedDate })
    vi.stubEnv('TMDB_ACCESS_TOKEN', '')
    const noKey = await read(profileId, { refresh: 'visible' })
    expect(noKey.refresh).toEqual({
      state: 'unavailable',
      cause: 'config',
      retryAfterMs: 0,
    })
    expect(ids(noKey)).toEqual([movie(950)])
    expect(fetchMock).not.toHaveBeenCalled()

    vi.stubEnv('TMDB_ACCESS_TOKEN', 'synthetic-test-key')
    expect((await read(profileId, { refresh: 'visible' })).refresh.state).toBe(
      'pending',
    )
    const offline = await settled()
    expect(offline.refresh).toMatchObject({
      state: 'unavailable',
      cause: 'network',
    })
    expect(ids(offline)).toEqual([movie(950)])
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(2)
    const watchlist = await read(profileId, {
      source: 'watchlist',
      refresh: 'visible',
    })
    expect(ids(watchlist)).toEqual([movie(950)])
    expect(watchlist.refresh.state).toBe('idle')
  })
})
