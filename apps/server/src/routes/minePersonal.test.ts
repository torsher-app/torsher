import type { HTTPMethods } from 'fastify'
import { createHash, randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import {
  afterAll,
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
  collectionHiddenProfiles,
  collections,
  cyclePlaybackFacts,
  devices,
  diaryEntries,
  diarySeen,
  metaCache,
  mineProfilePreferences,
  profiles,
  profileTitles,
  serverSettings,
  titleProgress,
  users,
} from '../db/schema.ts'
import { journalScope } from '../services/mine/journal.ts'
import { defaultProfile } from '../services/profiles/index.ts'
import { storeMetaCache } from '../services/tmdb/cache.ts'
import { ensureDiaryTimeZone } from '../services/transfer/diaryTimeZone.ts'
import { hashPassword } from '../utils/password.ts'
import { signToken } from '../utils/token.ts'

const app = createApp()
const owner = { [ACCESS_TOKEN_COOKIE]: signToken('owner', 'user_access') }
const movie = 'tmdb:movie:940001'
const show = 'tmdb:tv:940002'
const other = 'tmdb:movie:940003'
const cold = 'tmdb:movie:940004'
const day = '2025-11-02'
const language = 'en-US'
let profileId: string

beforeAll(async () => {
  expect(config.databasePath).toBe(':memory:')
  await migrateDb()
  getDb()
    .insert(users)
    .values({ id: 'owner', username: 'Owner', passwordHash: 'fixture' })
    .run()
  await app.ready()
})

beforeEach(() => {
  const db = getDb()
  for (const table of [devices, profiles, collections, metaCache])
    db.delete(table).run()
  db.delete(serverSettings)
    .where(eq(serverSettings.key, 'mine.diaryTimeZone'))
    .run()
  profileId = defaultProfile().id
})

afterAll(async () => {
  await app.close()
})

function api(
  path: string,
  options: {
    method?: HTTPMethods
    cookies?: Record<string, string>
    query?: Record<string, string>
    payload?: object
  } = {},
) {
  return app.inject({
    url: `/api/mine/v1/${path}`,
    cookies: owner,
    ...options,
  })
}

function query(extra = {}) {
  return { expectedProfileId: profileId, language, ...extra }
}

function manual(overrides = {}) {
  return {
    expectedProfileId: profileId,
    language,
    requestId: randomUUID(),
    target: { titleId: movie, season: 0, episode: 0 },
    date: { precision: 'day', day },
    note: 'ВЕЧЕР с семьёй',
    viewingContext: 'Дома',
    ...overrides,
  }
}

function seedDiary({
  titleId = movie,
  season = 0,
  episode = 0,
  date = day,
  instantAt,
  id = randomUUID(),
  rewatch = false,
}: {
  titleId?: string
  season?: number
  episode?: number
  date?: string | null
  instantAt?: string
  id?: string
  rewatch?: boolean
} = {}) {
  getDb()
    .insert(diaryEntries)
    .values({
      profileId,
      id,
      titleId,
      season,
      episode,
      rewatch,
      precision: instantAt ? 'instant' : date ? 'day' : 'unknown',
      instant: instantAt ? new Date(instantAt) : null,
      day: instantAt ? null : date,
      origin: 'manual',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .run()
  return id
}

function movieDetails(titleId = movie, certification = '6+') {
  storeMetaCache(`${titleId}:en-US:v3`, {
    id: Number(titleId.split(':').at(-1)),
    title: titleId === movie ? 'Autumn' : 'Restricted',
    original_title: 'Осень',
    release_date: '2022-12-12',
    runtime: 106,
    poster_path: '/synthetic.jpg',
    genres: [{ id: 18, name: 'Drama' }],
    production_countries: [{ iso_3166_1: 'GB' }],
    release_dates: {
      results: [{ iso_3166_1: 'RU', release_dates: [{ certification }] }],
    },
  })
}

function showDetails() {
  storeMetaCache(`${show}:en-US:v3`, {
    id: 940002,
    name: 'Show',
    original_name: 'Show',
    first_air_date: '2023-01-01',
    status: 'Ended',
    origin_country: ['GB'],
    genres: [{ id: 18, name: 'Drama' }],
    seasons: [
      {
        season_number: 2,
        episode_count: 2,
        air_date: '2024-01-01',
        name: 'Season 2',
      },
    ],
  })
  storeMetaCache(`${show}:season:2:en-US`, {
    episodes: [
      { episode_number: 1, name: 'One', air_date: '2024-01-01', runtime: 47 },
      { episode_number: 2, name: 'Two', air_date: '2024-01-02', runtime: 52 },
    ],
  })
}

describe('personal actions', () => {
  it('projects exact seen episodes without changing ordinary positions or expanding a title mark', async () => {
    showDetails()
    const db = getDb()
    db.insert(titleProgress)
      .values({
        profileId,
        titleId: show,
        season: 2,
        episode: 2,
        position: 300,
        duration: 1000,
      })
      .run()
    const progress = () =>
      app.inject({
        url: `/api/titles/${show}/progress`,
        query: { language },
        cookies: owner,
      })
    const before = (await progress()).json()
    const created = await api('diary', {
      method: 'POST',
      payload: manual({ target: { titleId: show, season: 2, episode: 1 } }),
    })
    expect(created.statusCode).toBe(200)
    db.insert(diarySeen)
      .values({ profileId, titleId: show, season: 0, episode: 0 })
      .run()
    db.insert(cyclePlaybackFacts)
      .values({
        profileId,
        titleId: show,
        season: 0,
        episode: 1,
        watchedAt: new Date(),
        updatedAt: new Date(),
      })
      .run()
    db.insert(titleProgress)
      .values({
        profileId,
        titleId: show,
        season: 0,
        episode: 2,
        watchedAt: new Date(),
        position: 0,
      })
      .run()
    const foreign = db
      .insert(profiles)
      .values({ name: 'Other', color: 'blue', position: 1 })
      .returning()
      .get()!
    db.insert(diarySeen)
      .values({ profileId: foreign.id, titleId: show, season: 2, episode: 9 })
      .run()
    const result = await progress()
    expect(result.statusCode, result.body).toBe(200)
    expect(result.json().seenEpisodes).toEqual([
      { season: 0, episode: 1 },
      { season: 0, episode: 2 },
      { season: 2, episode: 1 },
    ])
    expect(result.json().episodes).toEqual(before.episodes)
    expect(result.json().resume).toMatchObject({
      season: 2,
      episode: 2,
      position: 300,
    })
    const removed = await api(`title/${show}/seen`, {
      method: 'PUT',
      payload: { ...query(), season: 2, episode: 1, watched: false },
    })
    expect(removed.statusCode).toBe(200)
    expect((await progress()).json().seenEpisodes).not.toContainEqual({
      season: 2,
      episode: 1,
    })
    expect(db.select().from(diaryEntries).get()?.id).toBe(
      created.json().entry.id,
    )
  })

  it('keeps a manually marked special visible after a progress refetch', async () => {
    showDetails()
    storeMetaCache(`${show}:season:0:en-US`, {
      episodes: [
        {
          episode_number: 1,
          name: 'Special',
          air_date: '2024-01-01',
          runtime: 12,
        },
      ],
    })
    const marked = await api(`title/${show}/seen`, {
      method: 'PUT',
      payload: { ...query(), season: 0, episode: 1, watched: true },
    })
    expect(marked.statusCode, marked.body).toBe(200)
    const result = await app.inject({
      url: `/api/titles/${show}/progress`,
      query: { language },
      cookies: owner,
    })
    expect(result.statusCode).toBe(200)
    expect(result.json().seenEpisodes).toEqual([{ season: 0, episode: 1 }])
    expect(result.json().episodes).toEqual([])
    expect(result.json().resume).toBeNull()
  })
  it('records one manual gesture, keeps history and seen separate, and does not resurrect deleted entries', async () => {
    const payload = manual()
    const result = await api('diary', { method: 'POST', payload })
    expect(result.statusCode, result.body).toBe(200)
    expect(result.json()).toMatchObject({
      entry: {
        id: payload.requestId,
        date: payload.date,
        viewingContext: 'Дома',
        rewatch: false,
        metadata: null,
      },
    })
    const repeat = await api('diary', { method: 'POST', payload })
    expect(repeat.json()).toEqual(result.json())
    expect(
      (
        await api('diary', {
          method: 'POST',
          payload: { ...payload, note: 'Other' },
        })
      ).statusCode,
    ).toBe(409)
    expect(
      (
        await api('diary', {
          method: 'POST',
          payload: manual({ date: { precision: 'day', day: '9999-12-30' } }),
        })
      ).json(),
    ).toEqual({
      kind: 'invalidDate',
    })
    const watched = await api('watched', { query: query() })
    expect(watched.json()).toMatchObject({
      total: 1,
      items: [{ titleId: movie, metadata: null }],
    })
    expect(getDb().select().from(titleProgress).all()).toEqual([])
    const patched = await api(`diary/${payload.requestId}`, {
      method: 'PATCH',
      payload: { ...query(), note: null },
    })
    expect(patched.json()).toMatchObject({
      id: payload.requestId,
      note: null,
      viewingContext: 'Дома',
    })
    const removed = await api(`diary/${payload.requestId}`, {
      method: 'DELETE',
      query: { expectedProfileId: profileId },
    })
    expect(removed.statusCode, removed.body).toBe(204)
    expect((await api('diary', { method: 'POST', payload })).json()).toEqual({
      entry: null,
    })
    expect(getDb().select().from(diaryEntries).all()).toEqual([])
    expect(getDb().select().from(diarySeen).all()).toHaveLength(1)
    const unwatched = await api(`title/${movie}/seen`, {
      method: 'PUT',
      payload: { ...query(), season: 0, episode: 0, watched: false },
    })
    expect(unwatched.json()).toMatchObject({ seen: { title: false } })
    expect(getDb().select().from(diarySeen).all()).toHaveLength(0)
  })

  it('keeps manual rewatch explicit and leaves source-authored flags intact', async () => {
    const create = async (payload: object) => {
      const response = await api('diary', { method: 'POST', payload })
      expect(response.statusCode, response.body).toBe(200)
      return response.json().entry
    }
    const october = manual({ date: { precision: 'day', day: '2025-10-02' } })
    expect((await create(october)).rewatch).toBe(false)
    const replay = await create({ ...october, rewatch: false })
    expect(replay).toMatchObject({ rewatch: false, id: october.requestId })
    const conflict = await api('diary', {
      method: 'POST',
      payload: { ...october, rewatch: true },
    })
    expect(conflict.statusCode).toBe(409)
    expect(
      (await create(manual({ date: { precision: 'day', day: '2025-04-01' } })))
        .rewatch,
    ).toBe(false)
    const explicit = await create(
      manual({ date: { precision: 'unknown' }, rewatch: true }),
    )
    expect(explicit.rewatch).toBe(true)
    const edit = (id: string, values: object) =>
      api(`diary/${id}`, {
        method: 'PATCH',
        payload: { ...query(), ...values },
      })
    expect(
      (
        await edit(explicit.id, {
          date: { precision: 'day', day: '2025-01-01' },
        })
      ).json(),
    ).toMatchObject({ rewatch: true })
    expect((await edit(explicit.id, { rewatch: false })).json()).toMatchObject({
      rewatch: false,
    })

    const trakt = seedDiary({ rewatch: true })
    const cycle = seedDiary({
      rewatch: true,
      titleId: show,
      season: 2,
      episode: 1,
    })
    const db = getDb()
    db.update(diaryEntries)
      .set({ origin: 'trakt' })
      .where(eq(diaryEntries.id, trakt))
      .run()
    db.update(diaryEntries)
      .set({
        origin: 'playback',
        context: { kind: 'cycle', cycleId: randomUUID() },
      })
      .where(eq(diaryEntries.id, cycle))
      .run()
    for (const id of [trakt, cycle]) {
      expect((await edit(id, { rewatch: false })).statusCode).toBe(409)
      expect((await edit(id, { note: 'Updated note' })).json()).toMatchObject({
        rewatch: true,
        note: 'Updated note',
      })
    }
  })

  it('preserves a legacy rated title in Watched while the seen toggle tracks actual marks', async () => {
    getDb()
      .insert(profileTitles)
      .values({ profileId, titleId: movie, rating: 8 })
      .run()
    const listed = await api('watched', { query: query() })
    expect(listed.json()).toMatchObject({
      total: 1,
      items: [{ ownRating: 8 }],
    })
    const info = await api(`title/${movie}`, { query: query() })
    expect(info.json()).toMatchObject({
      status: 'watched',
      seen: { title: false },
    })
    const toggle = (watched: boolean) =>
      api(`title/${movie}/seen`, {
        method: 'PUT',
        payload: { ...query(), season: 0, episode: 0, watched },
      })
    expect((await toggle(true)).json()).toMatchObject({
      seen: { title: true },
    })
    expect((await toggle(false)).json()).toMatchObject({
      status: 'watched',
      seen: { title: false },
    })
  })

  it('adds episode seen without maintenance or Continue and removes seen while retaining the diary', async () => {
    showDetails()
    const payload = manual({
      target: { titleId: show, season: 2, episode: 1 },
    })
    const created = await api('diary', { method: 'POST', payload })
    expect(created.statusCode, created.body).toBe(200)
    const title = await api(`title/${show}`, {
      query: query({ season: '2', episode: '1' }),
    })
    expect(title.json()).toMatchObject({
      seen: { episode: true },
      status: 'watching',
    })
    const continuation = await api('continue', { query: query() })
    expect(continuation.json()).toMatchObject({ total: 0, items: [] })
    const removed = await api(`title/${show}/seen`, {
      method: 'PUT',
      payload: { ...query(), season: 2, episode: 1, watched: false },
    })
    expect(removed.json()).toMatchObject({ seen: { episode: false } })
    expect(getDb().select().from(diaryEntries).get()).toMatchObject({
      id: payload.requestId,
    })
    expect(
      getDb().select().from(titleProgress).get()?.watchedAt ?? null,
    ).toBeNull()
    const marked = await api(`title/${show}/seen`, {
      method: 'PUT',
      payload: { ...query(), season: 2, episode: 1, watched: true },
    })
    expect(marked.json()).toMatchObject({ seen: { episode: true } })
    expect(
      getDb().select().from(titleProgress).get()?.watchedAt,
    ).toBeInstanceOf(Date)
  })

  it('uses offline bootstrap, collections visibility and a foreign profile guard', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Unexpected network'))
    try {
      const db = getDb()
      const collection = db
        .insert(collections)
        .values({ name: 'Visible', nameKey: 'visible' })
        .returning()
        .get()
      const guest = db
        .insert(profiles)
        .values({ name: 'Guest', color: 'blue', position: 1 })
        .returning()
        .get()
      const bootstrap = await api('bootstrap')
      expect(bootstrap.statusCode, bootstrap.body).toBe(200)
      expect(bootstrap.json()).toMatchObject({
        profileId,
        start: { kind: 'section', section: 'continue' },
        counts: { continue: null, watchlist: 0 },
        collections: [{ id: collection.id, count: null }],
      })
      const changed = await api('start-section', {
        method: 'PUT',
        payload: {
          expectedProfileId: profileId,
          start: { kind: 'collection', collectionId: collection.id },
        },
      })
      expect(changed.json()).toEqual({
        start: { kind: 'collection', collectionId: collection.id },
      })
      const foreign = { ...owner, [PROFILE_COOKIE]: guest.id }
      const wrong = await api(`title/${movie}`, {
        method: 'PATCH',
        cookies: foreign,
        payload: { ...query(), note: 'Wrong profile' },
      })
      expect(wrong.statusCode).toBe(409)
      expect(wrong.json()).toEqual({ kind: 'profileChanged' })
      const created = await api('diary', { method: 'POST', payload: manual() })
      const entryId = created.json().entry.id
      const patch = await api(`diary/${entryId}`, {
        method: 'PATCH',
        cookies: foreign,
        payload: {
          expectedProfileId: guest.id,
          language,
          note: 'Foreign event',
        },
      })
      expect(patch.statusCode).toBe(404)
      db.update(collections)
        .set({ name: 'Renamed', nameKey: 'renamed' })
        .where(eq(collections.id, collection.id))
        .run()
      expect((await api('bootstrap')).json()).toMatchObject({
        start: { collectionId: collection.id },
        collections: [{ id: collection.id, name: 'Renamed' }],
      })
      db.insert(collectionHiddenProfiles)
        .values({ collectionId: collection.id, profileId })
        .run()
      expect((await api('bootstrap')).json()).toMatchObject({
        start: { kind: 'section', section: 'continue' },
        collections: [],
      })
      db.delete(collections).where(eq(collections.id, collection.id)).run()
      expect(
        db.select().from(mineProfilePreferences).get()?.startCollectionId,
      ).toBeNull()
      expect(fetch).not.toHaveBeenCalled()
    }
    finally {
      fetch.mockRestore()
    }
  })

  it('rejects a delayed episode log if the device changed profile during catalog validation', async () => {
    const db = getDb()
    const token = 'synthetic-device-token'
    const cookie = { [DEVICE_TOKEN_COOKIE]: token }
    const device = db
      .insert(devices)
      .values({
        name: 'TV',
        type: 'tv',
        tokenHash: createHash('sha256').update(token).digest('hex'),
        profileId,
      })
      .returning()
      .get()
    const guest = db
      .insert(profiles)
      .values({ name: 'Guest', color: 'blue', position: 1 })
      .returning()
      .get()
    const loading = Promise.withResolvers<void>()
    const ready = Promise.withResolvers<Response>()
    vi.stubEnv('TMDB_ACCESS_TOKEN', 'fixture')
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        loading.resolve()
        return ready.promise
      }),
    )
    const request = api('diary', {
      method: 'POST',
      cookies: cookie,
      payload: manual({ target: { titleId: show, season: 2, episode: 1 } }),
    })
    const closed = request.then(() => false)
    try {
      expect(
        await Promise.race([loading.promise.then(() => true), closed]),
      ).toBe(true)
      db.update(devices)
        .set({ profileId: guest.id })
        .where(eq(devices.id, device.id))
        .run()
      ready.resolve(
        new Response(
          JSON.stringify({
            id: 10,
            season_number: 2,
            episodes: [
              {
                episode_number: 1,
                name: 'First',
                air_date: '2024-02-02',
                runtime: 48,
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      const stale = await request
      expect(stale.statusCode, stale.body).toBe(409)
      expect(stale.json()).toEqual({ kind: 'profileChanged' })
      expect(db.select().from(diaryEntries).all()).toEqual([])
      expect(db.select().from(diarySeen).all()).toEqual([])
    }
    finally {
      ready.resolve(new Response('{}'))
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
    }
  })

  it('writes offline with a usable cached certification past the refresh interval', async () => {
    const db = getDb()
    db.update(profiles)
      .set({ ageLimit: 12 })
      .where(eq(profiles.id, profileId))
      .run()
    movieDetails()
    db.update(metaCache)
      .set({ fetchedAt: new Date(Date.now() - 179 * 86_400_000) })
      .run()
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Unexpected network'))
    try {
      const log = await api('diary', { method: 'POST', payload: manual() })
      expect(log.statusCode, log.body).toBe(200)
      const title = await api(`title/${movie}`, {
        method: 'PATCH',
        payload: { ...query(), note: 'Offline note' },
      })
      expect(title.json()).toMatchObject({ note: 'Offline note' })
      expect(fetch).not.toHaveBeenCalled()
    }
    finally {
      fetch.mockRestore()
    }
  })

  it('uses the paired device selection and existing PIN flow', async () => {
    const db = getDb()
    const token = 'synthetic-device-token'
    const cookie = { [DEVICE_TOKEN_COOKIE]: token }
    db.insert(devices)
      .values({
        name: 'TV',
        type: 'tv',
        tokenHash: createHash('sha256').update(token).digest('hex'),
      })
      .run()
    db.update(profiles)
      .set({ pinHash: await hashPassword('1234') })
      .where(eq(profiles.id, profileId))
      .run()
    expect((await api('bootstrap', { cookies: cookie })).statusCode).toBe(403)
    const select = () =>
      app.inject({
        method: 'POST',
        url: `/api/profiles/${profileId}/select`,
        cookies: cookie,
        payload: { pin: '1234' },
      })
    expect((await select()).statusCode).toBe(200)
    expect((await api('bootstrap', { cookies: cookie })).json()).toMatchObject({
      profileId,
    })
    const create = await api('diary', {
      method: 'POST',
      cookies: cookie,
      payload: manual(),
    })
    expect(create.statusCode, create.body).toBe(200)
  })
})

describe('calendar and journal', () => {
  it('uses the same positive runtime for the exact episode in the diary and overview', async () => {
    showDetails()
    const preferred = [
      { episode_number: 1, name: 'Первая серия', runtime: null },
      { episode_number: 2, name: 'Вторая серия', runtime: 0 },
      { episode_number: 3, name: 'Третья серия', runtime: 50 },
    ]
    storeMetaCache(`${show}:season:2:ru-RU`, { episodes: preferred })
    storeMetaCache(`${show}:season:2:en-US`, {
      episodes: [41, 42, 43].map((runtime, i) => ({
        episode_number: i + 1,
        name: `Episode ${i + 1}`,
        runtime,
      })),
    })
    for (const episode of [1, 2, 3])
      seedDiary({ titleId: show, season: 2, episode })

    const overview = async () => {
      const response = await api('overview', {
        query: query({ period: '2025-11', language: 'ru-RU' }),
      })
      expect(response.statusCode, response.body).toBe(200)
      return response.json()
    }
    const diary = await api('diary', {
      query: query({ month: '2025-11', language: 'ru-RU' }),
    })
    expect(
      diary
        .json()
        .entries.sort(
          (a: { episode: number }, b: { episode: number }) =>
            a.episode - b.episode,
        ),
    ).toMatchObject(
      [41, 42, 50].map((runtimeMinutes, i) => ({
        metadata: { episodeTitle: preferred[i]!.name, runtimeMinutes },
      })),
    )
    expect(await overview()).toMatchObject({
      totals: {
        episodes: 3,
        runtimeMinutes: 133,
        runtimeKnown: 3,
        runtimeUnknown: 0,
      },
    })

    // Other episodes and another season cannot fill the missing runtime.
    storeMetaCache(`${show}:season:1:ru-RU`, {
      episodes: [{ episode_number: 4, name: 'Other season', runtime: 60 }],
    })
    seedDiary({ titleId: show, season: 2, episode: 4 })
    const missing = await api('diary', {
      query: query({ month: '2025-11', language: 'ru-RU' }),
    })
    expect(
      missing
        .json()
        .entries.find((row: { episode: number }) => row.episode === 4),
    ).toMatchObject({
      metadata: { runtimeMinutes: null },
    })
    expect(await overview()).toMatchObject({
      totals: {
        episodes: 4,
        runtimeMinutes: 133,
        runtimeKnown: 3,
        runtimeUnknown: 1,
      },
    })
  })

  it('shows exact season data without a series card only where the profile can see the entry', async () => {
    storeMetaCache(`${show}:season:2:ru-RU`, {
      episodes: [
        { episode_number: 1, name: 'Первая серия', runtime: null },
        { episode_number: 2, name: 'Вторая серия', runtime: 0 },
      ],
    })
    storeMetaCache(`${show}:season:2:en-US`, {
      episodes: [
        { episode_number: 1, name: 'Episode 1', runtime: 41 },
        { episode_number: 2, name: 'Episode 2', runtime: 47 },
      ],
    })
    const first = seedDiary({ titleId: show, season: 2, episode: 1 })
    const second = seedDiary({ titleId: show, season: 2, episode: 2 })
    const missingEpisode = seedDiary({ titleId: show, season: 2, episode: 3 })
    const missingMovie = seedDiary()
    const emptyCard = {
      title: show,
      year: null,
      poster: null,
      genres: [],
      countries: [],
    }
    const expected = expect.arrayContaining([
      expect.objectContaining({
        id: first,
        metadata: {
          ...emptyCard,
          episodeTitle: 'Первая серия',
          runtimeMinutes: 41,
        },
      }),
      expect.objectContaining({
        id: second,
        metadata: {
          ...emptyCard,
          episodeTitle: 'Вторая серия',
          runtimeMinutes: 47,
        },
      }),
      expect.objectContaining({ id: missingEpisode, metadata: null }),
      expect.objectContaining({ id: missingMovie, metadata: null }),
    ])
    const diary = () =>
      api('diary', { query: query({ month: '2025-11', language: 'ru-RU' }) })
    const overview = () =>
      api('overview', {
        query: query({ period: '2025-11', language: 'ru-RU' }),
      })
    expect((await diary()).json()).toMatchObject({
      total: 4,
      entries: expected,
    })
    expect((await overview()).json()).toMatchObject({
      totals: {
        movies: 1,
        episodes: 3,
        runtimeMinutes: 88,
        runtimeKnown: 2,
        runtimeUnknown: 2,
      },
      recent: expected,
    })

    getDb()
      .update(profiles)
      .set({ ageLimit: 12 })
      .where(eq(profiles.id, profileId))
      .run()
    expect((await diary()).json()).toMatchObject({ total: 0, entries: [] })
    expect((await overview()).json()).toMatchObject({
      totals: {
        movies: 0,
        episodes: 0,
        runtimeMinutes: 0,
        runtimeKnown: 0,
        runtimeUnknown: 0,
      },
      recent: [],
    })
  })

  it('counts each title once per genre ID and country across duplicate and localized labels', async () => {
    movieDetails()
    storeMetaCache(`${show}:ru-RU:v3`, {
      id: 940002,
      name: 'Сериал',
      original_name: 'Show',
      first_air_date: '2023-01-01',
      status: 'Ended',
      origin_country: ['GB', 'GB'],
      seasons: [
        {
          season_number: 2,
          episode_count: 2,
          air_date: '2024-01-01',
          name: 'Сезон 2',
        },
      ],
      genres: [
        { id: 18, name: 'Драма' },
        { id: 18, name: 'Драма (альтернатива)' },
      ],
    })
    seedDiary({ titleId: show, season: 2, episode: 1 })
    seedDiary({ titleId: show, season: 2, episode: 2 })
    seedDiary()

    const overview = await api('overview', {
      query: query({ period: '2025-11', language: 'ru-RU' }),
    })
    expect(overview.statusCode, overview.body).toBe(200)
    expect(overview.json()).toMatchObject({
      interests: {
        genres: [{ value: 18, count: 2 }],
        countries: [{ value: 'GB', count: 2 }],
      },
    })
    for (const filter of [{ genre: '18' }, { country: 'GB' }]) {
      const drilled = await api('diary', {
        query: query({ ...filter, language: 'ru-RU', month: '2025-11' }),
      })
      expect(drilled.json()).toMatchObject({ total: 3, distinctTitles: 2 })
    }
  })

  it('groups both DST occurrences on the same local day and uses the same counts and filters as the diary', async () => {
    ensureDiaryTimeZone('America/New_York')
    movieDetails()
    showDetails()
    seedDiary({ instantAt: '2025-11-02T05:30:00Z' })
    seedDiary({
      instantAt: '2025-11-02T06:30:00Z',
      titleId: show,
      season: 2,
      episode: 1,
      rewatch: true,
    })
    seedDiary({ instantAt: '2025-11-01T03:59:00Z' })
    seedDiary({ titleId: show })
    seedDiary({ titleId: cold })
    seedDiary({ titleId: cold, date: null })
    getDb()
      .insert(profileTitles)
      .values({ profileId, titleId: other, rating: 8, ratedAt: new Date() })
      .run()

    const overview = await api('overview', {
      query: query({ period: '2025-11' }),
    })
    expect(overview.statusCode, overview.body).toBe(200)
    expect(overview.json()).toMatchObject({
      timeZone: 'America/New_York',
      totals: {
        movies: 2,
        episodes: 1,
        series: 1,
        rewatch: 1,
        days: 1,
        distinctMovies: 2,
        distinctEpisodes: 1,
        runtimeMinutes: 153,
        runtimeKnown: 2,
        runtimeUnknown: 2,
      },
      days: [{ day, count: 4 }],
      interests: {
        titles: 3,
        titlesWithMetadata: 2,
        genres: [{ value: 18, label: 'Drama', count: 2 }],
        countries: [{ value: 'GB', count: 2 }],
      },
      previousMarks: { movies: 0, series: 0 },
    })
    const all = await api('diary', { query: query() })
    expect(all.statusCode, all.body).toBe(200)
    expect(all.json().months).toEqual([
      { month: '2025-11', count: 4 },
      { month: '2025-10', count: 1 },
      { month: null, count: 1 },
    ])
    const details = await api('diary', {
      query: query({ day, genre: '18', country: 'GB' }),
    })
    expect(details.json()).toMatchObject({
      total: 3,
      distinctTitles: 2,
      entries: [
        { calendarDay: day, kind: 'episode' },
        { calendarDay: day, kind: 'movie' },
        { calendarDay: day, kind: 'series' },
      ],
    })
    const facets = query({
      month: '2025-11',
      genre: '18',
      country: 'GB',
      limit: '2',
    })
    seedDiary({ titleId: show, season: 2, episode: 2 })
    seedDiary({ titleId: movie, rewatch: true })
    const facetPage = (await api('diary', { query: facets })).json()
    expect(facetPage).toMatchObject({ total: 5, distinctTitles: 2 })
    const nextPage = (
      await api('diary', {
        query: { ...facets, cursor: facetPage.olderCursor },
      })
    ).json()
    expect(nextPage).toMatchObject({ total: 5, distinctTitles: 2 })
    const year = await api('overview', { query: query({ period: '2025' }) })
    expect(year.json()).toMatchObject({ totals: { days: 2, movies: 4 } })
    const byName = await api('diary', { query: query({ search: 'ОСЕНЬ' }) })
    expect(byName.json()).toMatchObject({ total: 3 })
    const unknown = await api('diary', { query: query({ date: 'unknown' }) })
    expect(unknown.json()).toMatchObject({
      total: 1,
      entries: [{ date: { precision: 'unknown' } }],
    })
    const written = await api('diary', { method: 'POST', payload: manual() })
    expect(written.statusCode, written.body).toBe(200)
    const byNote = await api('diary', { query: query({ search: 'вечер' }) })
    expect(byNote.json()).toMatchObject({ total: 1 })
    const byContext = await api('diary/months', {
      query: query({ search: 'ДОМА' }),
    })
    expect(byContext.json()).toMatchObject({
      months: [{ month: '2025-11', count: 1 }],
    })
  })

  it('derives Trakt repeats from earlier verified IDs outside the filtered window', async () => {
    const db = getDb()
    const trakt = (
      originKey: string,
      instantAt: string,
      titleId = movie,
      season = 0,
      episode = 0,
    ) => {
      const id = seedDiary({ instantAt, titleId, season, episode })
      db.update(diaryEntries)
        .set({ origin: 'trakt', originKey })
        .where(eq(diaryEntries.id, id))
        .run()
      return id
    }
    const identities = ['id:2', 'id:3', 'id:4', 'id:9223372036854775807']
    const months = identities.map((key, i) =>
      trakt(key, `2025-11-0${i + 2}T20:00:00Z`),
    )
    const first = trakt('id:1', '2025-10-01T12:00:00Z')
    const list = await api('diary', {
      query: query({ rewatch: 'only', month: '2025-11' }),
    })
    expect(list.json()).toMatchObject({
      total: 4,
      distinctTitles: 1,
      months: [{ month: '2025-11', count: 4 }],
    })
    expect(list.json().entries.map((row: { id: string }) => row.id)).toEqual(
      months.toReversed(),
    )
    const overview = await api('overview', {
      query: query({ period: '2025-11' }),
    })
    expect(overview.json()).toMatchObject({
      totals: { movies: 4, rewatch: 4 },
    })
    expect(
      overview
        .json()
        .recent.map((entry: { rewatch: boolean }) => entry.rewatch),
    ).toEqual([true, true, true, true])
    expect(
      db
        .select({ rewatch: diaryEntries.rewatch })
        .from(diaryEntries)
        .all()
        .every(row => !row.rewatch),
    ).toBe(true)
    const shifted = await api(`diary/${first}`, {
      method: 'PATCH',
      payload: { ...query(), date: { precision: 'day', day: '2025-12-01' } },
    })
    expect(shifted.json()).toMatchObject({ rewatch: true })
    expect(
      (
        await api('diary', {
          query: query({ rewatch: 'only', month: '2025-11' }),
        })
      ).json(),
    ).toMatchObject({ total: 3 })
    await api(`diary/${months[0]}`, {
      method: 'DELETE',
      query: { expectedProfileId: profileId },
    })
    expect(
      (await api('overview', { query: query({ period: '2025-11' }) })).json(),
    ).toMatchObject({ totals: { rewatch: 2 } })
  })

  it('does not infer repeats from the same minute, unknown dates, other coordinates, profiles, or source identities', async () => {
    const db = getDb()
    const save = (
      id: string,
      originKey: string,
      origin: 'trakt' | 'letterboxd' = 'trakt',
    ) =>
      db
        .update(diaryEntries)
        .set({ origin, originKey })
        .where(eq(diaryEntries.id, id))
        .run()
    const one = '2025-11-05T20:08:01Z'
    const two = '2025-11-05T20:08:59Z'
    save(seedDiary({ instantAt: one }), 'id:101')
    save(seedDiary({ instantAt: two }), 'id:102')
    save(seedDiary({ date: null }), 'id:103')
    save(seedDiary({ date: '2025-10-01' }), 'occurrence:old')
    save(seedDiary({ date: '2025-10-01' }), 'id:104', 'letterboxd')
    save(seedDiary({ date: '2025-10-01' }), 'id:00012')
    save(seedDiary({ date: '2025-10-01' }), 'id:9223372036854775808')
    save(
      seedDiary({ titleId: show, season: 1, episode: 1, instantAt: one }),
      'id:119',
    )
    save(
      seedDiary({ titleId: show, season: 1, episode: 2, instantAt: two }),
      'id:120',
    )
    const guest = db
      .insert(profiles)
      .values({ name: 'Guest', color: 'blue', position: 1 })
      .returning()
      .get()
    const foreign = seedDiary({ date: '2025-10-01' })
    db.update(diaryEntries)
      .set({ profileId: guest.id, origin: 'trakt', originKey: 'id:105' })
      .where(eq(diaryEntries.id, foreign))
      .run()
    expect(
      (await api('diary', { query: query({ rewatch: 'only' }) })).json(),
    ).toMatchObject({ total: 0 })
  })

  it('uses first-day interests only before the first visible dated watch', async () => {
    const db = getDb()
    db.update(profiles)
      .set({ ageLimit: 12, language: 'ru_RU' })
      .where(eq(profiles.id, profileId))
      .run()
    expect((await api('bootstrap')).json()).toMatchObject({
      language: 'ru_RU',
    })
    movieDetails()
    movieDetails(other, '18+')
    db.insert(profileTitles)
      .values([
        { profileId, titleId: movie, rating: 8, favoriteAt: new Date() },
        { profileId, titleId: other, rating: 9 },
        { profileId, titleId: cold, favoriteAt: new Date() },
      ])
      .run()
    seedDiary({ titleId: other })
    seedDiary({ titleId: movie, date: null })
    const empty = await api('overview', {
      query: query({ period: '2025-11' }),
    })
    expect(empty.json()).toMatchObject({
      totals: { movies: 0, days: 0 },
      interests: {
        source: 'ratingsAndFavorites',
        titles: 1,
        genres: [{ value: 18, count: 1 }],
      },
      previousMarks: { movies: 0 },
      recent: [],
    })
    const drilldown = await api('watched', {
      query: query({
        source: 'ratingsAndFavorites',
        genre: '18',
        country: 'GB',
      }),
    })
    expect(drilldown.json()).toMatchObject({
      total: 1,
      items: [{ titleId: movie }],
    })
    seedDiary({ titleId: movie, date: '2025-09-02' })
    const emptyPeriod = await api('overview', {
      query: query({ period: '2025-11' }),
    })
    expect(emptyPeriod.json()).toMatchObject({
      totals: { days: 0 },
      interests: { source: 'diary', titles: 0, genres: [] },
    })
  })

  it('uses the same real earlier marks in Overview and the filtered title list', async () => {
    const db = getDb()
    const now = new Date()
    const seen = { profileId, season: 0, episode: 0, position: 0 }
    movieDetails()
    movieDetails(other)
    showDetails()
    db.insert(profileTitles)
      .values([
        { profileId, titleId: other, rating: 9 },
        { profileId, titleId: show, favoriteAt: now },
      ])
      .run()
    db.insert(titleProgress)
      .values([
        {
          ...seen,
          titleId: movie,
          position: 950,
          watchedAt: now,
          lastPlayedAt: now,
          updatedAt: now,
        },
        {
          ...seen,
          titleId: show,
          season: 2,
          episode: 1,
          position: 950,
          watchedAt: now,
          updatedAt: now,
        },
        { ...seen, titleId: cold, watchedAt: now, updatedAt: now },
      ])
      .run()
    seedDiary({ titleId: cold })

    const overview = await api('overview', { query: query() })
    expect(overview.json()).toMatchObject({
      previousMarks: {
        movies: 1,
        series: 0,
        examples: [{ titleId: movie }],
      },
    })
    const earlier = await api('watched', {
      query: query({ source: 'earlierMarks', genre: '18', country: 'GB' }),
    })
    expect(earlier.json()).toMatchObject({
      total: 1,
      items: [{ titleId: movie }],
    })
    const ordinary = await api('watched', {
      query: query({ genre: '18', country: 'GB' }),
    })
    expect(ordinary.json()).toMatchObject({ total: 2 })
    expect(
      (
        await api('watched', { query: query({ genre: '99', country: 'GB' }) })
      ).json(),
    ).toMatchObject({ total: 0 })
    const seed = await api('watched', {
      query: query({
        source: 'ratingsAndFavorites',
        kind: 'movie',
        rating: '9-10',
        offset: '1',
      }),
    })
    expect(seed.json()).toMatchObject({ total: 1, items: [] })
    const favorite = await api('watched', {
      query: query({
        source: 'ratingsAndFavorites',
        kind: 'series',
        rating: 'unrated',
      }),
    })
    expect(favorite.json()).toMatchObject({
      total: 1,
      items: [{ titleId: show }],
    })
  })

  it('fails closed on a fresh corrupt or unknown RU certification and allows valid EN when RU expired', async () => {
    const db = getDb()
    db.update(profiles)
      .set({ ageLimit: 12 })
      .where(eq(profiles.id, profileId))
      .run()
    movieDetails()
    movieDetails(other)
    movieDetails(cold)
    db.insert(metaCache)
      .values([
        { key: `${movie}:ru-RU:v3`, json: '{broken', fetchedAt: new Date() },
        { key: `${other}:ru-RU:v3`, json: 'null', fetchedAt: new Date() },
        {
          key: `${cold}:ru-RU:v3`,
          json: '{broken',
          fetchedAt: new Date(Date.now() - 181 * 86_400_000),
        },
      ])
      .run()
    for (const titleId of [movie, other, cold]) seedDiary({ titleId })
    const list = await api('diary', { query: query() })
    expect(list.json()).toMatchObject({
      total: 1,
      entries: [{ titleId: cold }],
    })
    expect((await api(`title/${movie}`, { query: query() })).statusCode).toBe(
      404,
    )
    expect((await api(`title/${other}`, { query: query() })).statusCode).toBe(
      404,
    )
    expect((await api(`title/${cold}`, { query: query() })).statusCode).toBe(
      200,
    )
  })

  it('applies cached ratings before counts, filters and paging for limited profiles', async () => {
    const db = getDb()
    db.update(profiles)
      .set({ ageLimit: 12 })
      .where(eq(profiles.id, profileId))
      .run()
    movieDetails()
    movieDetails(other, '18+')
    seedDiary()
    seedDiary({ titleId: other })
    seedDiary({ titleId: cold, date: null })
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Unexpected network'))
    try {
      const diary = await api('diary', { query: query({ limit: '1' }) })
      expect(diary.json()).toMatchObject({
        total: 1,
        olderCursor: null,
        entries: [{ titleId: movie }],
      })
      const overview = await api('overview', {
        query: query({ period: '2025' }),
      })
      expect(overview.json()).toMatchObject({
        totals: { movies: 1, days: 1 },
        interests: { titles: 1 },
      })
      const months = await api('diary/months', { query: query() })
      expect(months.json()).toEqual({
        months: [{ month: '2025-11', count: 1 }],
      })
      expect(fetch).not.toHaveBeenCalled()
    }
    finally {
      fetch.mockRestore()
    }
  })

  it('pages in both directions over tied dates and keeps the selected month as an anchor only', async () => {
    for (const date of [
      '2025-12-08',
      '2025-11-18',
      '2025-11-18',
      '2025-09-02',
      null,
    ])
      seedDiary({ date })
    const root = await api('diary', { query: query({ limit: '2' }) })
    const first = root.json()
    expect(first).toMatchObject({
      total: 5,
      newerCursor: null,
      entries: [{ calendarDay: '2025-12-08' }, { calendarDay: '2025-11-18' }],
    })
    const next = (
      await api('diary', {
        query: query({ limit: '2', cursor: first.olderCursor }),
      })
    ).json()
    expect(
      next.entries.map((entry: { calendarDay: string }) => entry.calendarDay),
    ).toEqual(['2025-11-18', '2025-09-02'])
    expect(next.entries[0].id).not.toBe(first.entries[1].id)
    const back = await api('diary', {
      query: query({
        limit: '2',
        direction: 'newer',
        cursor: next.newerCursor,
      }),
    })
    expect(back.json().entries).toEqual(first.entries)
    const anchor = await api('diary', {
      query: query({ anchorMonth: '2025-11' }),
    })
    expect(anchor.json()).toMatchObject({
      total: 5,
      entries: [
        { calendarDay: '2025-11-18' },
        { calendarDay: '2025-11-18' },
        { calendarDay: '2025-09-02' },
        { calendarDay: null },
      ],
    })
    const month = await api('diary', { query: query({ month: '2025-11' }) })
    expect(month.json()).toMatchObject({ total: 2 })
  })

  it('bounds diary output on a 30,000-row profile and uses indexed date and instant arms', async () => {
    const db = getDb()
    const now = Date.now()
    db.run(sql`
      WITH RECURSIVE seq(i) AS (VALUES(1) UNION ALL SELECT i + 1 FROM seq WHERE i < 30000)
      INSERT INTO diary_entries (profile_id, id, title_id, season, episode, precision, day, origin, created_at, updated_at)
      SELECT ${profileId}, printf('00000000-0000-4000-8000-%012d', i), ${movie}, 0, 0, 'day',
        date('2025-01-01', '-' || (i % 500) || ' days'), 'manual', ${now}, ${now} FROM seq
    `)
    const filter = {
      kind: 'all',
      rewatch: 'any',
      date: 'any',
      month: '2025-01',
    } as const
    const plan = db.all<{ detail: string }>(sql`
      EXPLAIN QUERY PLAN ${journalScope({ profileId, language, filter })} SELECT id FROM result
    `)
    expect(
      plan.some(
        row =>
          row.detail.includes('diary_entries_day_idx')
          && row.detail.includes('day>?'),
      ),
    ).toBe(true)
    expect(
      plan.some(
        row =>
          row.detail.includes('diary_entries_instant_idx')
          && row.detail.includes('instant>?'),
      ),
    ).toBe(true)
    const result = await api('diary', { query: query() })
    expect(result.statusCode, result.body.slice(0, 500)).toBe(200)
    const page = result.json()
    expect(page.total).toBe(30000)
    expect(page.entries).toHaveLength(40)
    expect(page.olderCursor).toBeTruthy()
  })
})
