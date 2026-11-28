import type { ArrPreviewRow } from '../dto/arrTransfer.ts'
import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { createApp } from '../app.ts'
import { ACCESS_TOKEN_COOKIE, DEVICE_TOKEN_COOKIE } from '../config.ts'
import { getDb, migrateDb } from '../db/index.ts'
import {
  followEpisodes,
  followProfiles,
  follows,
  metaCache,
  profiles,
  users,
} from '../db/schema.ts'
import { followOf } from '../services/follow/index.ts'
import {
  requestedSearch,
  resetFollowSearch,
} from '../services/follow/search.ts'
import { netResolveDeps } from '../services/net/index.ts'
import { trustedHttpDeps } from '../services/net/trustedHttp.ts'
import { storeMetaCache } from '../services/tmdb/cache.ts'
import { titleDetailsCacheKey } from '../services/tmdb/certification.ts'
import { saveTmdbKey } from '../services/tmdb/credentials.ts'
import { signToken } from '../utils/token.ts'

const route = '/api/transfer/arr'
const owner = { [ACCESS_TOKEN_COOKIE]: signToken('owner', 'user_access') }
const profileId = 'profile-arr'
const key = 'synthetic-arr-key'
const lan = '192.168.241.33'
const versions = { sonarr: '4.0.20.3014', radarr: '7.0.3.10918' }
const fetchTmdb = vi.fn<typeof fetch>()
type App = ReturnType<typeof createApp>

let app: App

beforeAll(async () => {
  await migrateDb()
  saveTmdbKey('synthetic-metadata-key')
  getDb()
    .insert(users)
    .values({ id: 'owner', username: 'owner', passwordHash: 'hash' })
    .run()
})

beforeEach(() => {
  app = createApp()
  getDb()
    .insert(profiles)
    .values({ id: profileId, name: 'Test profile', color: 'blue', position: 0 })
    .run()
  vi.stubGlobal('fetch', fetchTmdb)
  fetchTmdb.mockReset()
  fetchTmdb.mockImplementation(async (input) => {
    const id = Number(new URL(String(input)).pathname.split('/').at(-1))
    return Response.json(movieDetails(id))
  })
  vi.spyOn(netResolveDeps, 'routeAddresses').mockResolvedValue([lan])
})

afterEach(async () => {
  await app.close()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  const db = getDb()
  db.delete(follows).run()
  db.delete(profiles).run()
  db.delete(metaCache).run()
  resetFollowSearch()
})

function movieDetails(id: number) {
  return {
    id,
    title: `Fixture movie ${id}`,
    original_title: `Fixture movie ${id}`,
    release_date: '2026-08-10',
    overview: '',
    vote_average: 0,
    vote_count: 0,
    poster_path: null,
    backdrop_path: null,
    original_language: 'ru',
    genres: [],
  }
}

function seriesDetails(id: number, extras: object = {}) {
  return {
    ...movieDetails(id),
    name: `Fixture series ${id}`,
    original_name: `Fixture series ${id}`,
    first_air_date: '2001-02-01',
    seasons: [
      {
        season_number: 1,
        name: 'Season 1',
        episode_count: 10,
        air_date: '2001-02-01',
      },
    ],
    last_episode_to_air: {
      season_number: 1,
      episode_number: 3,
      air_date: '2001-02-10',
    },
    next_episode_to_air: {
      season_number: 1,
      episode_number: 4,
      air_date: '2001-02-15',
    },
    ...extras,
  }
}

function radarrRow(id: number, changes: object = {}) {
  return {
    id,
    title: `Source movie ${id}`,
    year: 2026,
    tmdbId: id + 1000,
    monitored: true,
    hasFile: false,
    ...changes,
  }
}

function sonarrRow(id: number, changes: object = {}) {
  return {
    id,
    title: `Source series ${id}`,
    monitored: true,
    tvdbId: id + 1000,
    status: 'continuing',
    monitorNewItems: 'all',
    seasons: [
      { seasonNumber: 0, monitored: false },
      { seasonNumber: 1, monitored: true },
    ],
    ...changes,
  }
}

function mockSource(
  kind: keyof typeof versions,
  rows: unknown[],
  version = versions[kind],
) {
  const destroy = vi.fn(async () => {})
  const send = vi
    .spyOn(trustedHttpDeps, 'send')
    .mockImplementation(async url => ({
      destroy,
      response: url.pathname.endsWith('/system/status')
        ? Response.json({
            appName: kind === 'sonarr' ? 'Sonarr' : 'Radarr',
            version,
          })
        : Response.json(rows),
    }))
  return { send, destroy }
}

function request(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  payload?: object,
) {
  const cookies = { [ACCESS_TOKEN_COOKIE]: signToken('owner', 'user_access') }
  return app.inject({ method, url: `${route}${path}`, cookies, payload })
}

async function connection(
  kind: keyof typeof versions,
  url = 'http://arr.fixture/arr-base/',
) {
  const res = await request('POST', '/connection', { kind, url })
  expect(res.statusCode, res.body).toBe(200)
  expect(res.headers['cache-control']).toBe('no-store')
  return res.json<{ id: string, origin: string, addresses: string[] }>()
}

function start(connectionId: string, changes: object = {}) {
  return request('POST', '/preview', {
    connectionId,
    apiKey: key,
    profileId,
    language: 'en-US',
    approveLan: true,
    ...changes,
  })
}

async function waitPreview(id: string) {
  return vi.waitFor(async () => {
    const response = await request('GET', `/preview/${id}`)
    expect(
      response.statusCode === 200 && response.json().state === 'preparing',
    ).toBe(false)
    return response
  })
}

async function ready(kind: keyof typeof versions) {
  const verification = await connection(kind)
  const started = await start(verification.id)
  expect(started.statusCode, started.body).toBe(202)
  const { id } = started.json<{ id: string }>()
  const response = await waitPreview(id)
  expect(response.statusCode, response.body).toBe(200)
  expect(response.headers['cache-control']).toBe('no-store')
  return {
    id,
    ...response.json<{
      checked: number
      total: number
      rows: ArrPreviewRow[]
    }>(),
  }
}

function apply(previewId: string, rowIds: string[]) {
  return request('POST', '/apply', { previewId, rowIds })
}

describe('arr source import', () => {
  it('requires an owner session for every operation before making any upstream calls', async () => {
    const { send } = mockSource('radarr', [])
    const missing = randomUUID()
    for (const [method, path] of [
      ['POST', '/connection'],
      ['POST', '/preview'],
      ['GET', `/preview/${missing}`],
      ['DELETE', `/preview/${missing}`],
      ['POST', '/apply'],
    ] as const) {
      const url = `${route}${path}`
      const anonymous = await app.inject({ method, url })
      expect(anonymous.statusCode).toBe(401)
      expect(
        (
          await app.inject({
            method,
            url,
            cookies: { [DEVICE_TOKEN_COOKIE]: randomUUID() },
          })
        ).statusCode,
      ).toBe(401)
      const crossSite = await app.inject({
        method,
        url,
        cookies: owner,
        headers: {
          'sec-fetch-site': 'cross-site',
          'origin': 'https://foreign.example',
        },
      })
      expect(crossSite.statusCode).toBe(403)
    }
    expect(netResolveDeps.routeAddresses).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it.each(['5.28.0.10274', '6.4.4.10685', '7.0.3.10918'])(
    'reads and imports Radarr %s with one explicit paused follow',
    async (version) => {
      const { send, destroy } = mockSource(
        'radarr',
        [
          radarrRow(1),
          radarrRow(2, { hasFile: true }),
          radarrRow(3, { hasFile: null }),
          radarrRow(4, { monitored: false }),
          radarrRow(5, { title: key }),
          radarrRow(6, { monitored: 'true' }),
          radarrRow(7, { tmdbId: 0 }),
        ],
        version,
      )
      const verification = await connection('radarr')
      expect(verification).toMatchObject({
        origin: 'http://arr.fixture',
        addresses: [lan],
      })
      expect(send).not.toHaveBeenCalled()
      expect(
        (await start(verification.id, { approveLan: false })).json(),
      ).toMatchObject({ kind: 'address' })
      expect(send).not.toHaveBeenCalled()

      const started = await start(verification.id)
      expect(started.statusCode, started.body).toBe(202)
      const { id } = started.json<{ id: string }>()
      const response = await waitPreview(id)
      expect(response.statusCode, response.body).toBe(200)
      const { rows } = response.json<{ rows: ArrPreviewRow[] }>()
      expect(rows.map(row => row.reasons)).toEqual([
        [],
        ['has_file'],
        ['unknown_file'],
        ['unmonitored'],
        ['invalid'],
        ['invalid'],
        ['unmatched'],
      ])
      expect(rows.map(row => row.selected)).toEqual([
        true,
        false,
        false,
        false,
        false,
        false,
        false,
      ])
      expect([started.body, response.body].join()).not.toContain(key)
      expect(getDb().select().from(follows).all()).toEqual([])
      expect(
        send.mock.calls.map(([url, addresses, options]) => [
          url.pathname,
          addresses,
          options.method,
          options.headers.get('X-Api-Key'),
        ]),
      ).toEqual([
        ['/arr-base/api/v3/system/status', [lan], 'GET', key],
        ['/arr-base/api/v3/movie', [lan], 'GET', key],
      ])
      expect(destroy).toHaveBeenCalledTimes(2)

      expect((await apply(id, [rows[3]!.id])).json()).toMatchObject({
        kind: 'request',
      })
      const calls = fetchTmdb.mock.calls.length
      const result = await apply(id, [rows[0]!.id])
      expect(result.statusCode, result.body).toBe(200)
      expect(result.json()).toMatchObject({
        created: 1,
        skipped: 0,
        failed: 0,
      })
      expect(result.body).not.toContain(key)
      expect(fetchTmdb).toHaveBeenCalledTimes(calls)
      expect(fetchTmdb.mock.calls.flat().join()).not.toContain(key)
      expect(send).toHaveBeenCalledTimes(2)
      expect(followOf('tmdb:movie:1001')).toMatchObject({
        state: 'paused',
        mode: 'notify',
        startSeason: 0,
        startEpisode: 0,
        createdByProfileId: profileId,
        requireRussian: false,
      })
      expect(getDb().select().from(followProfiles).all()).toMatchObject([
        { profileId },
      ])
      expect(getDb().select().from(followEpisodes).all()).toEqual([])
      expect(requestedSearch(followOf('tmdb:movie:1001')!.id)).toBeUndefined()
      expect((await apply(id, [rows[0]!.id])).body).toBe(result.body)
      expect((await apply(id, [rows[1]!.id])).json()).toMatchObject({
        kind: 'expired',
      })

      const repeated = await ready('radarr')
      expect(repeated.rows[0]).toMatchObject({
        selectable: false,
        reasons: ['existing'],
      })
    },
  )

  it('maps monitored Sonarr series by type and preserves season warnings and a future cursor', async () => {
    mockSource('sonarr', [
      sonarrRow(1, { tmdbId: 2001 }),
      sonarrRow(2, { imdbId: 'tt2002', status: 'upcoming' }),
      sonarrRow(3, { tmdbId: 2003, monitorNewItems: 'none', status: 'ended' }),
      sonarrRow(4, { seasons: [{ seasonNumber: 0, monitored: true }] }),
      sonarrRow(5, { seasons: [] }),
      sonarrRow(6, { status: 'deleted' }),
      sonarrRow(7, { monitored: false }),
      sonarrRow(8, { tmdbId: 2001 }),
      sonarrRow(9, { tmdbId: 2009 }),
      sonarrRow(10, { tmdbId: 2010 }),
    ])
    fetchTmdb.mockImplementation(async (input) => {
      const path = new URL(String(input)).pathname.split('/')
      const id = path.at(-1)
      if (path.includes('find')) {
        return Response.json({
          tv_results: [{ id: 2002 }],
          movie_results: [{ id: 1100 }],
        })
      }
      return Response.json(
        seriesDetails(
          Number(id),
          id === '2009'
            ? { external_ids: { tvdb_id: 1040 } }
            : id === '2010'
              ? {
                  last_episode_to_air: null,
                  next_episode_to_air: {
                    season_number: 0,
                    episode_number: 4,
                    air_date: '2026-12-20',
                  },
                }
              : {},
        ),
      )
    })

    const preview = await ready('sonarr')
    expect(preview.rows.map(row => row.reasons)).toEqual([
      [],
      [],
      ['partial_monitoring', 'ended'],
      ['no_monitored_seasons'],
      ['no_monitored_seasons'],
      ['deleted'],
      ['unmonitored'],
      ['duplicate'],
      ['conflict'],
      ['unknown_cursor'],
    ])
    expect(preview.rows.slice(0, 3).map(row => row.sourceStatus)).toEqual([
      'continuing',
      'upcoming',
      'ended',
    ])
    expect(preview.rows[5]?.sourceStatus).toBe('deleted')
    expect(preview.rows.slice(0, 3).every(row => row.selectable)).toBe(true)
    expect(preview.rows[2]?.selected).toBe(false)
    expect(
      fetchTmdb.mock.calls
        .map(([input]) => new URL(String(input)).pathname)
        .filter(path => path === '/3/tv/2001'),
    ).toHaveLength(1)

    const result = await apply(preview.id, [
      preview.rows[0]!.id,
      preview.rows[1]!.id,
    ])
    expect(result.json()).toMatchObject({ created: 2, failed: 0 })
    expect(followOf('tmdb:tv:2001')).toMatchObject({
      state: 'paused',
      mode: 'notify',
      startSeason: 1,
      startEpisode: 5,
    })
  })

  it('separates ambiguity, unavailable TMDB and absent matches and rejects stale data when refresh fails', async () => {
    mockSource('sonarr', [
      sonarrRow(1, { imdbId: 'tt1' }),
      sonarrRow(2, { imdbId: 'tt2' }),
      sonarrRow(3),
      sonarrRow(4, { tmdbId: 2004 }),
      sonarrRow(5, { tmdbId: 2005 }),
    ])
    const staleKey = titleDetailsCacheKey(
      { type: 'tv', tmdbId: 2005 },
      'en-US',
    )
    storeMetaCache(staleKey, seriesDetails(2005))
    getDb()
      .update(metaCache)
      .set({ fetchedAt: new Date(Date.now() - 20 * 86_400_000) })
      .where(eq(metaCache.key, staleKey))
      .run()
    fetchTmdb.mockImplementation(async (input) => {
      const id = new URL(String(input)).pathname.split('/').at(-1)
      if (id === '1001')
        return Response.json({ tv_results: [{ id: 101 }, { id: 102 }] })
      if (id === '1002' || id === 'tt1')
        return Response.json({ tv_results: [{ id: 101 }] })
      if (id === 'tt2')
        return Response.json({ tv_results: [{ id: 102 }] })
      if (id === '1003') {
        return Response.json({
          movie_results: [{ id: 101 }],
          tv_episode_results: [{ id: 101 }],
        })
      }
      return new Response(null, { status: id === '2004' ? 404 : 503 })
    })
    const preview = await ready('sonarr')
    expect(preview.rows.map(row => row.reasons)).toEqual([
      ['conflict'],
      ['conflict'],
      ['unmatched'],
      ['unmatched'],
      ['tmdb_unavailable'],
    ])
    expect(getDb().select().from(follows).all()).toEqual([])
  })

  it('keeps all existing follow states and their subscriptions through an apply race and a partial write failure', async () => {
    mockSource(
      'radarr',
      Array.from({ length: 7 }, (_, index) => radarrRow(index + 1)),
    )
    const db = getDb()
    db.insert(profiles)
      .values({ id: 'original', name: 'Original', color: 'rose', position: 1 })
      .run()
    const register = (
      id: number,
      state: 'active' | 'paused' | 'stopped' | 'done',
    ) => {
      const followId = `existing-${id}`
      db.insert(follows)
        .values({
          id: followId,
          titleId: `tmdb:movie:${1000 + id}`,
          kind: 'movie',
          state,
          mode: 'download',
          startSeason: 0,
          startEpisode: 0,
          waitHours: 812,
          requireRussian: true,
          updatedAt: new Date('2026-01-01'),
        })
        .run()
      db.insert(followProfiles)
        .values({ followId, profileId: 'original' })
        .run()
    }
    register(1, 'active')
    register(2, 'paused')
    register(3, 'stopped')
    register(4, 'done')
    const preview = await ready('radarr')
    expect(preview.rows.slice(0, 4).map(row => row.reasons)).toEqual(
      Array.from({ length: 4 }).fill(['existing']),
    )
    register(5, 'stopped')
    const originals = db.select().from(follows).all()
    const memberships = db.select().from(followProfiles).all()
    db.run(sql`CREATE TEMP TRIGGER fail_arr_subscribe BEFORE INSERT ON follow_profiles
      WHEN (SELECT title_id FROM follows WHERE id = NEW.follow_id) = 'tmdb:movie:1006'
      BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END`)
    try {
      const selected = preview.rows.slice(4).map(row => row.id)
      const res = await apply(preview.id, selected)
      expect(res.statusCode, res.body).toBe(200)
      expect(res.json()).toMatchObject({
        created: 1,
        skipped: 1,
        failed: 1,
        rows: [
          { outcome: 'skipped' },
          { outcome: 'failed' },
          { outcome: 'created' },
        ],
      })
      expect((await apply(preview.id, selected.reverse())).body).toBe(res.body)
      expect(followOf('tmdb:movie:1006')).toBeUndefined()
      expect(followOf('tmdb:movie:1007')?.state).toBe('paused')
      expect(
        db
          .select()
          .from(follows)
          .all()
          .filter(row => row.id.startsWith('existing-')),
      ).toEqual(originals)
      expect(
        db
          .select()
          .from(followProfiles)
          .all()
          .filter(row => row.profileId === 'original'),
      ).toEqual(memberships)
    }
    finally {
      db.run(sql`DROP TRIGGER fail_arr_subscribe`)
    }
    const retry = await ready('radarr')
    expect(retry.rows[5]?.selectable).toBe(true)
    expect(retry.rows[6]?.reasons).toEqual(['existing'])
  })

  it('checks profile eligibility at preview and again before apply', async () => {
    const { send } = mockSource('radarr', [radarrRow(1)])
    const token = await connection('radarr')
    const db = getDb()
    db.update(profiles)
      .set({ ageLimit: 8 })
      .where(eq(profiles.id, profileId))
      .run()
    expect((await start(token.id)).json()).toMatchObject({ kind: 'profile' })
    expect(send).not.toHaveBeenCalled()
    db.update(profiles)
      .set({ ageLimit: null })
      .where(eq(profiles.id, profileId))
      .run()
    const started = await start(token.id)
    const { id } = started.json<{ id: string }>()
    const preview = (await waitPreview(id)).json<{ rows: ArrPreviewRow[] }>()
    db.delete(profiles).where(eq(profiles.id, profileId)).run()
    expect((await apply(id, [preview.rows[0]!.id])).json()).toMatchObject({
      kind: 'profile',
    })
    expect(db.select().from(follows).all()).toEqual([])
  })

  it('never follows redirects or reuses an approved connection after the LAN resolution changes', async () => {
    const { send } = mockSource('radarr', [])
    const original = await connection('radarr')
    vi.mocked(netResolveDeps.routeAddresses).mockResolvedValue([
      '192.168.241.34',
    ])
    const started = await start(original.id)
    const { id } = started.json<{ id: string }>()
    expect((await waitPreview(id)).json()).toMatchObject({
      kind: 'address_changed',
    })
    expect(send).not.toHaveBeenCalled()
    expect((await start(original.id)).json()).toMatchObject({
      kind: 'expired',
    })

    send.mockResolvedValueOnce({
      response: new Response(key, {
        status: 302,
        headers: { Location: 'https://other.example/elsewhere' },
      }),
      destroy: async () => {},
    })
    const next = await connection('radarr')
    const nextId = (await start(next.id)).json<{ id: string }>().id
    const error = await waitPreview(nextId)
    expect(error.json()).toMatchObject({ kind: 'bad_response' })
    expect(error.body).not.toContain(key)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it.each([
    [new Response(key, { status: 401 }), 'auth'],
    [
      Response.json({ appName: 'Sonarr', version: '4.0.20.3014' }),
      'unsupported',
    ],
    [Response.json({ appName: 'Radarr', version: '8.0.1' }), 'unsupported'],
    [Response.json({ arbitrary: key }), 'bad_response'],
    [new Response('<html>not JSON</html>'), 'bad_response'],
  ])('sanitizes a failing instance response as %s', async (upstream, kind) => {
    const { send } = mockSource('radarr', [])
    send.mockResolvedValueOnce({ response: upstream, destroy: async () => {} })
    const token = await connection('radarr')
    const { id } = (await start(token.id)).json<{ id: string }>()
    const result = await waitPreview(id)
    expect(result.statusCode).toBe(422)
    expect(result.json()).toMatchObject({ kind })
    expect(result.body).not.toContain(key)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('rejects an oversized list without trying to match a truncated set', async () => {
    mockSource(
      'radarr',
      Array.from({ length: 1001 }, (_, index) => radarrRow(index + 1)),
    )
    const token = await connection('radarr')
    const { id } = (await start(token.id)).json<{ id: string }>()
    expect((await waitPreview(id)).json()).toMatchObject({ kind: 'limit' })
    expect(fetchTmdb).not.toHaveBeenCalled()
  })

  it('requires HTTPS for a public host and rejects prohibited forms without sending a key', async () => {
    const { send } = mockSource('radarr', [])
    vi.mocked(netResolveDeps.routeAddresses).mockResolvedValue(['8.8.4.4'])
    for (const url of [
      'http://arr.fixture/',
      'https://arr.fixture/library?key=wrong',
      'https://arr.fixture/library#config',
      'https://owner@arr.fixture/',
      'http://127.0.0.1:7878/',
      'https://arr.fixture/library/../other',
    ]) {
      const response = await request('POST', '/connection', {
        kind: 'radarr',
        url,
      })
      expect(response.json()).toMatchObject({ kind: 'address' })
    }
    expect(send).not.toHaveBeenCalled()
    const token = await connection('radarr', 'https://arr.fixture/remote/')
    expect(token).toMatchObject({
      origin: 'https://arr.fixture',
      addresses: [],
    })
    const { id } = (await start(token.id, { approveLan: false })).json<{
      id: string
    }>()
    expect((await waitPreview(id)).json()).toMatchObject({
      state: 'ready',
      total: 0,
      rows: [],
    })
    expect(send.mock.calls[0]?.[1]).toEqual(['8.8.4.4'])
  })

  it('expires unused approvals and ready snapshots without depending on timer dispatch', async () => {
    const { send } = mockSource('radarr', [radarrRow(1)])
    const now = Date.now()
    const time = vi.spyOn(Date, 'now')
    const expired = await connection('radarr')
    time.mockReturnValue(now + 6 * 60_000)
    expect((await start(expired.id)).json()).toMatchObject({ kind: 'expired' })
    expect(send).not.toHaveBeenCalled()
    time.mockReturnValue(now)
    const preview = await ready('radarr')
    time.mockReturnValue(now + 31 * 60_000)
    expect(
      (await request('GET', `/preview/${preview.id}`)).json(),
    ).toMatchObject({ kind: 'expired' })
    expect(
      (await apply(preview.id, [preview.rows[0]!.id])).json(),
    ).toMatchObject({ kind: 'expired' })
    expect(getDb().select().from(follows).all()).toEqual([])
  })

  it('honors TMDB Retry-After for work dispatched after a 429 while retaining completed rows', async () => {
    mockSource(
      'radarr',
      Array.from({ length: 5 }, (_, index) => radarrRow(index + 1)),
    )
    let blockedAt: number | undefined
    let lastRequestAt: number | undefined
    fetchTmdb.mockImplementation(async (input) => {
      const id = Number(new URL(String(input)).pathname.split('/').at(-1))
      if (id === 1001) {
        blockedAt = Date.now()
        return new Response(null, {
          status: 429,
          headers: { 'Retry-After': '1' },
        })
      }
      if (id === 1005)
        lastRequestAt = Date.now()
      else await new Promise(resolve => setTimeout(resolve, 25))
      return Response.json(movieDetails(id))
    })
    const token = await connection('radarr')
    const { id } = (await start(token.id)).json<{ id: string }>()
    const result = await vi.waitFor(
      async () => {
        const response = await request('GET', `/preview/${id}`)
        const value = response.json<{ state: string, rows: ArrPreviewRow[] }>()
        expect(value.state).toBe('ready')
        return value
      },
      { timeout: 3000 },
    )
    expect(result.rows.map(row => row.selectable)).toEqual([
      false,
      true,
      true,
      true,
      true,
    ])
    expect(result.rows[0]?.reasons).toEqual(['tmdb_unavailable'])
    expect(lastRequestAt! - blockedAt!).toBeGreaterThanOrEqual(1000)
  })

  it('does not pass the Arr key upstream when an external identifier echoes it', async () => {
    mockSource('sonarr', [sonarrRow(1, { tvdbId: 0, imdbId: 'tt1234567' })])
    const token = await connection('sonarr')
    const { id } = (await start(token.id, { apiKey: 'tt1234567' })).json<{
      id: string
    }>()
    const response = await waitPreview(id)
    expect(response.json()).toMatchObject({
      rows: [{ selectable: false, reasons: ['unmatched'] }],
    })
    expect(response.body).not.toContain('tt1234567')
    expect(fetchTmdb).not.toHaveBeenCalled()
  })

  it('aborts reading on cancellation and makes concurrent starts see the reserved slot', async () => {
    const { send } = mockSource('radarr', [])
    let upstreamSignal: AbortSignal | undefined
    send.mockImplementationOnce(async (_url, _addresses, options) => {
      upstreamSignal = options.signal
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener(
          'abort',
          () => reject(options.signal.reason),
          { once: true },
        )
      })
    })
    const token = await connection('radarr')
    const { id } = (await start(token.id)).json<{ id: string }>()
    await vi.waitFor(() => expect(upstreamSignal).toBeDefined())
    expect((await start(token.id)).json()).toMatchObject({ kind: 'busy' })
    expect((await request('GET', `/preview/${id}`)).json()).toMatchObject({
      state: 'preparing',
    })
    expect((await request('DELETE', `/preview/${id}`)).statusCode).toBe(204)
    expect(upstreamSignal?.aborted).toBe(true)
    expect((await request('GET', `/preview/${id}`)).json()).toMatchObject({
      kind: 'expired',
    })
  })
})
