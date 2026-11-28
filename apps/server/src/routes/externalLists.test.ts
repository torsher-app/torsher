import type {
  ExternalListPreviewJob,
  ExternalListWire,
} from '../dto/externalLists.ts'
import { eq } from 'drizzle-orm'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from 'vitest'
import { createApp } from '../app.ts'
import { ACCESS_TOKEN_COOKIE } from '../config.ts'
import { getDb, migrateDb } from '../db/index.ts'
import {
  diarySeen,
  externalListDecisions,
  externalLists,
  followHistory,
  follows,
  notifications,
  profileTitles,
  torrents,
  users,
} from '../db/schema.ts'
import {
  startExternalListScheduler,
  stopExternalListScheduler,
} from '../services/externalLists/index.ts'
import { getMineRow, updateMine } from '../services/mine/index.ts'
import { createProfile, defaultProfile } from '../services/profiles/index.ts'
import {
  deleteSetting,
  getSetting,
  setSetting,
} from '../services/settings/index.ts'
import { movie } from '../services/tmdb/fixtures/index.ts'
import { signToken } from '../utils/token.ts'

const path = '/api/settings/external-lists'
const key = 'some-synthetic-test-secret'
const cookies = { [ACCESS_TOKEN_COOKIE]: signToken('owner', 'user_access') }
const app = createApp()
const fetchMock = vi.fn<typeof fetch>()
const MINUTE = 60_000
const CLOCK = Date.UTC(2026, 10, 28, 10)
let time = CLOCK
let profileId = ''
let respond: (request: URL) => Response | Promise<Response>

function json(value: unknown, status = 200, headers?: Record<string, string>) {
  return new Response(JSON.stringify(value), { status, headers })
}

function movieTitle(id: number, certification?: string) {
  return {
    ...movie,
    id,
    title: `Synthetic title ${id}`,
    imdb_id: `tt123${id}`,
    release_dates: certification
      ? { results: [{ iso_3166_1: 'RU', release_dates: [{ certification }] }] }
      : undefined,
  }
}

function providerRows(...ids: number[]) {
  return (url: URL) => {
    if (url.pathname.endsWith('/items'))
      return json({ movies: ids.map(id => ({ id })), shows: [] })
    return json({
      id: Number(url.pathname.split('/').at(-1)),
      name: 'Synthetic list',
      private: false,
    })
  }
}

function advance(minutes: number) {
  time += minutes * MINUTE
  vi.setSystemTime(time)
  cookies[ACCESS_TOKEN_COOKIE] = signToken('owner', 'user_access')
}

async function settings() {
  return (await app.inject({ url: path, cookies })).json<{
    hasKey: boolean
    keyRejected: boolean
    lists: ExternalListWire[]
  }>()
}

async function latest(id: string) {
  return (await settings()).lists.find(list => list.id === id)
}

async function keyOf(apiKey: string | null) {
  return app.inject({
    method: 'PUT',
    url: `${path}/key`,
    payload: { apiKey },
    cookies,
  })
}

async function begin(source: number, target = profileId) {
  const response = await app.inject({
    method: 'POST',
    url: `${path}/preview`,
    cookies,
    payload: {
      source: String(source),
      profileId: target,
      media: 'all',
      intervalHours: 24,
    },
  })
  expect(response.statusCode).toBe(202)
  return response.json<ExternalListPreviewJob>().token
}

async function awaitPreview(token: string) {
  return vi.waitFor(async () => {
    const response = await app.inject({
      url: `${path}/preview/${token}`,
      cookies,
    })
    expect(response.statusCode).toBe(200)
    const job = response.json<ExternalListPreviewJob>()
    expect(job.status).not.toBe('pending')
    return job
  })
}

async function confirm(token: string) {
  return app.inject({
    method: 'POST',
    url: `${path}/confirm`,
    payload: { token },
    cookies,
  })
}

async function attach(source: number, target = profileId) {
  const token = await begin(source, target)
  expect((await awaitPreview(token)).status).toBe('ready')
  const applied = await confirm(token)
  expect(applied.statusCode).toBe(200)
  return applied.json<ExternalListWire>()
}

async function rerun(id: string) {
  const response = await app.inject({
    method: 'POST',
    url: `${path}/${id}/run`,
    cookies,
  })
  expect(response.statusCode).toBe(202)
  return vi.waitFor(async () => {
    const list = await latest(id)
    expect(list?.running).toBe(false)
    return list!
  })
}

beforeAll(async () => {
  await migrateDb()
  getDb()
    .insert(users)
    .values({ id: 'owner', username: 'Owner', passwordHash: 'test' })
    .run()
  profileId = defaultProfile().id
})

beforeEach(async () => {
  const db = getDb()
  db.delete(externalLists).run()
  db.delete(externalListDecisions).run()
  db.delete(profileTitles).run()
  db.delete(diarySeen).run()
  deleteSetting('externalLists.mdblist')
  deleteSetting('maintenanceRestoreHold')
  advance(60)
  respond = providerRows(3050)

  fetchMock.mockImplementation(async (input) => {
    const url = new URL(String(input))
    if (url.origin === 'https://api.mdblist.com')
      return respond(url)
    if (
      url.origin === 'https://api.themoviedb.org'
      && url.pathname.startsWith('/3/movie/')
    ) {
      return json(movieTitle(Number(url.pathname.split('/').at(-1)), '6+'))
    }
    throw new Error('Unexpected external request')
  })
  vi.stubEnv('TMDB_ACCESS_TOKEN', 'tmdb-fixture-token')
  vi.stubGlobal('fetch', fetchMock)
  expect((await keyOf(key)).statusCode).toBe(200)
})

afterEach(() => {
  stopExternalListScheduler()
  fetchMock.mockReset()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

afterAll(async () => {
  vi.useRealTimers()
  await app.close()
})

it('requires an owner and confirms a bounded preview without exposing the key or granting other privileges', async () => {
  const denied = await app.inject({ url: path })
  expect(denied.statusCode).toBe(401)
  const crossSite = await app.inject({
    method: 'PUT',
    url: `${path}/key`,
    cookies,
    headers: { 'sec-fetch-site': 'cross-site' },
    payload: { apiKey: null },
  })
  expect(crossSite.statusCode).toBe(403)
  expect(JSON.stringify(getSetting('externalLists.mdblist'))).not.toContain(
    key,
  )
  expect(await settings()).toEqual({
    hasKey: true,
    keyRejected: false,
    lists: [],
  })

  const token = await begin(11)
  const preview = await awaitPreview(token)
  expect(preview.preview?.items).toEqual([
    { titleId: 'tmdb:movie:3050', title: 'Synthetic title 3050' },
  ])
  expect(getMineRow(profileId, 'tmdb:movie:3050')).toBeUndefined()
  expect(await settings()).not.toHaveProperty('apiKey')
  const callsBefore = fetchMock.mock.calls.length
  const applied = (await confirm(token)).json<ExternalListWire>()
  expect(applied.lastResult?.counts?.added).toBe(1)
  expect(getMineRow(profileId, 'tmdb:movie:3050')?.watchlistAt).toBeInstanceOf(
    Date,
  )
  expect(fetchMock.mock.calls.length).toBe(callsBefore)
  expect((await confirm(token)).json()).toEqual({ message: 'previewExpired' })
  for (const table of [follows, followHistory, torrents, notifications])
    expect(getDb().select().from(table).all()).toEqual([])
})

it('keeps a manual removal during the first preview and across overlapping lists', async () => {
  const id = 'tmdb:movie:3050'
  updateMine(profileId, id, { watchlist: true, favorite: true })
  const token = await begin(11)
  expect((await awaitPreview(token)).preview?.counts.existing).toBe(1)

  const removed = await app.inject({
    method: 'PATCH',
    url: `/api/titles/${id}/mine?language=en-US`,
    cookies,
    payload: { watchlist: false },
  })
  expect(removed.statusCode).toBe(200)
  expect(removed.json().watchlist).toBe(false)

  expect(
    (await confirm(token)).json<ExternalListWire>().lastResult?.counts?.excluded,
  ).toBe(1)
  advance(2)
  expect((await attach(12)).lastResult?.counts?.excluded).toBe(1)
  expect(getMineRow(profileId, id)?.watchlistAt).toBeNull()
  expect(getMineRow(profileId, id)?.favoriteAt).toBeInstanceOf(Date)

  const child = createProfile({
    name: 'Second',
    color: 'blue',
    ageLimit: null,
    language: 'en_US',
  })
  advance(2)
  expect((await attach(12, child.id)).lastResult?.counts?.added).toBe(1)

  const exclusions = await app.inject({
    url: `${path}/exclusions?profileId=${profileId}`,
    cookies,
  })
  expect(exclusions.json().items).toEqual([
    { titleId: id, title: 'Synthetic title 3050' },
  ])
  const reset = await app.inject({
    url: `${path}/exclusions`,
    method: 'DELETE',
    payload: { profileId, titleId: id },
    cookies,
  })
  expect(reset.statusCode).toBe(204)
  advance(16)
  const overlapping = (await settings()).lists.find(
    list => list.sourceId === 12 && list.profileId === profileId,
  )!
  expect((await rerun(overlapping.id)).lastResult?.counts?.added).toBe(1)
})

it('keeps the last complete read and writes nothing when the next page fails', async () => {
  const list = await attach(11)
  respond = (url) => {
    if (!url.pathname.endsWith('/items'))
      return json({ id: 11, name: 'Synthetic list', private: false })
    return url.searchParams.get('cursor')
      ? json({ unavailable: true }, 503)
      : json({ movies: [{ id: 3051 }], pagination: { next_cursor: 'next' } })
  }
  advance(16)
  const failed = await rerun(list.id)
  expect(failed.lastResult).toEqual({
    status: 'error',
    error: 'providerError',
    counts: null,
  })
  expect(failed.lastReadAt).toBe(list.lastReadAt)
  expect(getMineRow(profileId, 'tmdb:movie:3051')).toBeUndefined()
})

it('honors a shared Retry-After across manual runs and previews on other lists', async () => {
  const first = await attach(11)
  advance(2)
  const other = await attach(12)
  advance(16)
  respond = () =>
    json({ service: 'rate limit' }, 429, { 'Retry-After': '3600' })
  expect((await rerun(first.id)).lastResult?.error).toBe('retryLater')

  const callsBefore = fetchMock.mock.calls.length
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `${path}/${other.id}/run`,
        cookies,
      })
    ).statusCode,
  ).toBe(429)
  const preview = await app.inject({
    method: 'POST',
    url: `${path}/preview`,
    cookies,
    payload: { source: '17', profileId, media: 'all', intervalHours: 24 },
  })
  expect(preview.statusCode).toBe(429)
  expect(fetchMock.mock.calls.length).toBe(callsBefore)
})

it('skips imported watched films and keeps unknown-age titles out of a restricted profile', async () => {
  const child = createProfile({
    name: 'Restricted',
    color: 'blue',
    ageLimit: 12,
    language: 'en_US',
  })
  getDb()
    .insert(diarySeen)
    .values({
      profileId: child.id,
      titleId: 'tmdb:movie:3061',
      season: 0,
      episode: 0,
    })
    .run()
  respond = providerRows(3061, 3062, 3063)
  const handle = fetchMock.getMockImplementation()!
  fetchMock.mockImplementation(async (input, init) => {
    const url = new URL(String(input))
    if (url.pathname === '/3/movie/3062')
      return json(movieTitle(3062))
    return handle(input, init)
  })
  const list = await attach(11, child.id)
  expect(list.lastResult?.counts).toMatchObject({
    watched: 1,
    restricted: 1,
    added: 1,
  })
  expect(getMineRow(child.id, 'tmdb:movie:3063')?.watchlistAt).toBeInstanceOf(
    Date,
  )
  expect(getMineRow(child.id, 'tmdb:movie:3062')).toBeUndefined()
})

it('never applies a run overtaken by a pause', async () => {
  const { id, lastReadAt } = await attach(11)
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const newRows = providerRows(3064)
  respond = async (url) => {
    await held
    return newRows(url)
  }
  advance(16)
  const started = await app.inject({
    method: 'POST',
    url: `${path}/${id}/run`,
    cookies,
  })
  expect(started.statusCode).toBe(202)
  const paused = await app.inject({
    method: 'PATCH',
    url: `${path}/${id}`,
    cookies,
    payload: { paused: true },
  })
  expect(paused.json()).toMatchObject({
    paused: true,
    running: false,
    nextRunAt: null,
  })
  release()
  const next = await vi.waitFor(() => begin(12))
  expect((await awaitPreview(next)).status).toBe('ready')
  expect(getMineRow(profileId, 'tmdb:movie:3064')).toBeUndefined()
  expect((await latest(id))?.lastReadAt).toBe(lastReadAt)
})

it('uses typed strict IMDb resolution and refuses a contradictory ID', async () => {
  respond = url =>
    url.pathname.endsWith('/items')
      ? json({
          movies: [
            { imdb_id: 'tt1233065' },
            { imdb_id: 'tt1233066' },
            { id: 3067, imdb_id: 'tt1233099' },
          ],
        })
      : json({ id: 11, name: 'Synthetic list', private: false })
  const handle = fetchMock.getMockImplementation()!
  fetchMock.mockImplementation(async (input, init) => {
    const url = new URL(String(input))
    if (url.pathname === '/3/find/tt1233065')
      return json({ movie_results: [{ id: 3065 }], tv_results: [{ id: 501 }] })
    if (url.pathname === '/3/find/tt1233066')
      return json({ movie_results: [{ id: 3066 }, { id: 3068 }] })
    return handle(input, init)
  })
  const list = await attach(11)
  expect(list.lastResult?.counts).toMatchObject({
    found: 3,
    added: 1,
    unmatched: 2,
  })
  expect(getMineRow(profileId, 'tmdb:movie:3065')?.watchlistAt).toBeInstanceOf(
    Date,
  )
  expect(getMineRow(profileId, 'tmdb:movie:3067')).toBeUndefined()
})

it('continues a bounded run, without resurrecting a title cleared by consumption', async () => {
  const ids = Array.from({ length: 51 }, (_, index) => 3100 + index)
  respond = providerRows(...ids)
  const initial = await attach(11)
  expect(initial.lastResult?.counts).toMatchObject({ added: 50, pending: 1 })
  // Rating a movie consumes its Watch later mark, while retaining its sync receipt.
  const id = 'tmdb:movie:3100'
  updateMine(profileId, id, { rating: 8 })
  updateMine(profileId, id, { rating: null })
  expect(getMineRow(profileId, id)?.watchlistAt).toBeUndefined()

  stopExternalListScheduler()
  advance(16)
  const second = await rerun(initial.id)
  expect(second.lastResult?.counts).toMatchObject({ added: 1, handled: 50 })
  expect(getMineRow(profileId, id)).toBeUndefined()
  expect(getMineRow(profileId, 'tmdb:movie:3150')?.watchlistAt).toBeInstanceOf(
    Date,
  )
})

it('drops a pending confirmation on key rotation and preserves accumulated quota', async () => {
  const token = await begin(11)
  expect((await awaitPreview(token)).status).toBe('ready')
  expect(getSetting('externalLists.mdblist')).toMatchObject({ attempts: 2 })
  await keyOf('replacement')
  expect((await confirm(token)).json()).toEqual({ message: 'previewExpired' })
  expect(getSetting('externalLists.mdblist')).toMatchObject({ attempts: 2 })
  expect(getMineRow(profileId, 'tmdb:movie:3050')).toBeUndefined()
})

it('holds all external work while a restored library is pending review', async () => {
  const token = await begin(11)
  expect((await awaitPreview(token)).status).toBe('ready')
  setSetting('maintenanceRestoreHold', true)
  expect((await confirm(token)).statusCode).toBe(429)
  expect(getMineRow(profileId, 'tmdb:movie:3050')).toBeUndefined()
  expect(await settings()).toMatchObject({ lists: [] })
})

it('does not extend a short-window Retry-After to the daily reset while daily quota remains', async () => {
  const first = await attach(11)
  advance(2)
  const other = await attach(12)
  advance(16)
  respond = () =>
    json({ service: 'read rate limit' }, 429, {
      'Retry-After': '180',
      'X-RateLimit-Remaining': '950',
      'X-RateLimit-Reset': String((Date.now() + 10 * 60 * MINUTE) / 1_000),
    })

  const throttled = await rerun(first.id)
  expect(throttled.nextRunAt).toBe(Date.now() + 15 * MINUTE)
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `${path}/${other.id}/run`,
        cookies,
      })
    ).statusCode,
  ).toBe(429)

  advance(4)
  respond = providerRows(3051)
  expect((await rerun(other.id)).lastResult?.counts?.added).toBe(1)
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `${path}/${first.id}/run`,
        cookies,
      })
    ).statusCode,
  ).toBe(429)
})

it('starts the oldest eligible schedule when an older due list is cooling down', async () => {
  const first = await attach(11)
  advance(2)
  const second = await attach(12)
  advance(16)

  const db = getDb()
  db.update(externalLists)
    .set({ lastAttemptAt: time, nextRunAt: time - 2 * MINUTE })
    .where(eq(externalLists.id, first.id))
    .run()
  db.update(externalLists)
    .set({ nextRunAt: time - MINUTE })
    .where(eq(externalLists.id, second.id))
    .run()

  respond = providerRows(3051)
  const callsBefore = fetchMock.mock.calls.length
  startExternalListScheduler()
  await vi.waitFor(async () => {
    expect(await latest(second.id)).toMatchObject({
      running: false,
      lastAttemptAt: time,
      lastResult: { counts: { added: 1 } },
    })
  })
  const requests = fetchMock.mock.calls
    .slice(callsBefore)
    .map(([url]) => new URL(String(url)))
  expect(requests.some(url => url.pathname === '/lists/11')).toBe(false)
  expect(requests.some(url => url.pathname === '/lists/12')).toBe(true)
})

it('cancels editing preview on pause and releases its work slot', async () => {
  const { id } = await attach(11)
  advance(2)
  const handle = fetchMock.getMockImplementation()!
  let blocked: AbortSignal | undefined
  fetchMock.mockImplementation((input, init) => {
    if (new URL(String(input)).pathname !== '/lists/11')
      return handle(input, init)
    blocked = init?.signal ?? undefined
    return new Promise((_resolve, reject) => {
      blocked?.addEventListener('abort', () => reject(blocked?.reason), {
        once: true,
      })
    })
  })

  const pending = await app.inject({
    method: 'POST',
    url: `${path}/preview`,
    cookies,
    payload: {
      source: '11',
      profileId,
      media: 'all',
      intervalHours: 24,
      listId: id,
    },
  })
  expect(pending.statusCode).toBe(202)
  const { token } = pending.json<ExternalListPreviewJob>()
  await vi.waitFor(() => expect(blocked).toBeDefined())
  expect((await latest(id))?.running).toBe(false)
  const paused = await app.inject({
    method: 'PATCH',
    url: `${path}/${id}`,
    cookies,
    payload: { paused: true },
  })
  expect(paused.statusCode).toBe(200)
  expect(blocked?.aborted).toBe(true)
  expect(
    (await app.inject({ url: `${path}/preview/${token}`, cookies })).json(),
  ).toEqual({ message: 'previewExpired' })

  advance(2)
  const next = await vi.waitFor(() => begin(12))
  expect((await awaitPreview(next)).status).toBe('ready')
})

it('preserves a list backoff through pausing, resuming and key rotation', async () => {
  const { id } = await attach(11)
  respond = () => json({ unavailable: true }, 503)
  advance(16)
  await rerun(id)
  advance(16)
  const failed = await rerun(id)
  expect(failed.nextRunAt).toBeGreaterThanOrEqual(time + 30 * MINUTE)
  advance(16)
  const pause = async (paused: boolean) => {
    const result = await app.inject({
      method: 'PATCH',
      url: `${path}/${id}`,
      cookies,
      payload: { paused },
    })
    expect(result.statusCode).toBe(200)
    return result.json<ExternalListWire>()
  }
  expect((await pause(true)).nextRunAt).toBeNull()
  expect((await pause(false)).nextRunAt).toBe(failed.nextRunAt)

  await keyOf('replacement')
  expect((await latest(id))?.paused).toBe(true)
  expect((await pause(false)).nextRunAt).toBe(failed.nextRunAt)
  expect(
    (await app.inject({ method: 'POST', url: `${path}/${id}/run`, cookies }))
      .statusCode,
  ).toBe(429)

  advance(15)
  respond = providerRows(3051)
  expect((await rerun(id)).lastResult?.counts?.added).toBe(1)
})
