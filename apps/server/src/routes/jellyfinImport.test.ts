import type { JellyfinPreview } from '../dto/jellyfinImport.ts'
import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { createApp } from '../app.ts'
import { ACCESS_TOKEN_COOKIE } from '../config.ts'
import { getDb, migrateDb } from '../db/index.ts'
import {
  cyclePlaybackFacts,
  diaryEntries,
  diarySeen,
  profileImports,
  profiles,
  titleProgress,
  users,
} from '../db/schema.ts'
import { netResolveDeps } from '../services/net/index.ts'
import { trustedHttpDeps } from '../services/net/trustedHttp.ts'
import { getTitleSummary, tmdbEpisodeExists } from '../services/tmdb/index.ts'
import { signToken } from '../utils/token.ts'

vi.mock('../services/tmdb/index.ts', async (actual) => {
  const original = await actual<typeof import('../services/tmdb/index.ts')>()
  return { ...original, getTitleSummary: vi.fn(), tmdbEpisodeExists: vi.fn() }
})

const profileId = 'jellyfin-target'
const anotherProfile = 'jellyfin-other'
const route = `/api/profiles/${profileId}/imports/jellyfin`
const lan = '192.168.241.33'
const serverId = '00000000000000000000000000000001'
const userId = '00000000000000000000000000000002'
const seriesId = '00000000000000000000000000000003'
const sourceUrl = 'https://jellyfin.example/jellyfin'
const username = 'Fixture viewer'
const secret = 'synthetic-source-password'
const accessToken = 'synthetic-source-token'
const user = { Id: userId, Name: username }
let app: ReturnType<typeof createApp>

beforeAll(async () => {
  await migrateDb()
  getDb().insert(users).values({
    id: 'jellyfin-owner',
    username: 'owner',
    passwordHash: 'hash',
  }).run()
})

beforeEach(() => {
  app = createApp({ trustProxy: true })
  getDb().insert(profiles).values([
    { id: profileId, name: 'Target', color: 'blue', position: 0 },
    { id: anotherProfile, name: 'Other', color: 'blue', position: 1 },
  ]).run()
  vi.spyOn(netResolveDeps, 'routeAddresses').mockResolvedValue([lan])
  vi.mocked(getTitleSummary).mockImplementation(async id => ({
    details: { id },
  }) as Awaited<ReturnType<typeof getTitleSummary>>)
  vi.mocked(tmdbEpisodeExists).mockImplementation(async (_, season, episode, _language, expectedId) =>
    season === 1 && episode === 2 && expectedId === 9999)
})

afterEach(async () => {
  await app.close()
  getDb().delete(profiles).run()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

function request(method: 'GET' | 'POST' | 'DELETE', path: string, payload?: object, headers: Record<string, string> = { 'x-forwarded-proto': 'https' }) {
  const cookies = { [ACCESS_TOKEN_COOKIE]: signToken('jellyfin-owner', 'user_access') }
  return app.inject({ method, url: `${route}${path}`, cookies, payload, headers })
}

async function connect(url = sourceUrl) {
  const response = await request('POST', '/connection', { url })
  expect(response.statusCode, response.body).toBe(200)
  expect(response.headers['cache-control']).toBe('no-store')
  return response.json<{ id: string, address: string, addresses: string[] }>()
}

function start(connectionId: string, headers?: Record<string, string>) {
  return request('POST', '/preview', { connectionId, username, password: secret }, headers)
}

async function ready(id: string) {
  return vi.waitFor(async () => {
    const response = await request('GET', `/preview/${id}`)
    expect(response.statusCode, response.body).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.body).not.toContain(accessToken)
    expect(response.body).not.toContain(secret)
    const preview = response.json<JellyfinPreview>()
    expect(preview.state).not.toBe('reading')
    return preview
  })
}

function movie(id: number, tmdb: number, played = true) {
  return {
    Id: String(id).padStart(32, '0'),
    Type: 'Movie',
    ProviderIds: { Tmdb: String(tmdb) },
    UserData: { Played: played, LastPlayedDate: '2020-01-02T12:00:00.0000000Z', PlaybackPositionTicks: 123 },
  }
}

function episode(id: number, number: number, changes = {}) {
  return {
    Id: String(id).padStart(32, '0'),
    Type: 'Episode',
    SeriesId: seriesId,
    ProviderIds: { Tmdb: '9999' },
    ParentIndexNumber: 1,
    IndexNumber: number,
    UserData: { Played: true },
    ...changes,
  }
}

type BeforeReply = (path: string, signal: AbortSignal) => Promise<Response | undefined>

function mockSource(rows: unknown[] = [], beforeReply?: BeforeReply) {
  const destroy = vi.fn(async () => {})
  const send = vi.spyOn(trustedHttpDeps, 'send').mockImplementation(async (url, addresses, options) => {
    const path = url.pathname
    expect(url.origin).toBe('https://jellyfin.example')
    expect(url.search).not.toContain(accessToken)
    expect(addresses).toEqual([lan])
    const extra = await beforeReply?.(path, options.signal)
    if (extra)
      return { destroy, response: extra }
    let response: Response
    switch (path) {
      case '/jellyfin/System/Info/Public':
        expect(options.headers.get('Authorization')).not.toContain('Token=')
        response = Response.json({ Id: serverId, ServerName: 'Fixture Jellyfin', Version: '10.11.5' })
        break
      case '/jellyfin/Users/AuthenticateByName':
        expect(options.method).toBe('POST')
        expect(JSON.parse(String(options.body))).toEqual({ Username: username, Pw: secret })
        response = Response.json({ AccessToken: accessToken, ServerId: serverId, User: user })
        break
      case '/jellyfin/Users/Me':
        response = Response.json(user)
        break
      case '/jellyfin/Items': {
        expect(url.searchParams.get('userId')).toBe(userId)
        expect(url.searchParams.get('isPlayed')).toBe('true')
        expect(url.searchParams.get('includeItemTypes')).toBe('Movie,Episode')
        const index = Number(url.searchParams.get('startIndex'))
        response = Response.json({ Items: rows.slice(index, index + 100), StartIndex: index, TotalRecordCount: rows.length })
        break
      }
      case `/jellyfin/Items/${seriesId}`:
        expect(url.searchParams.get('userId')).toBe(userId)
        response = Response.json({ Id: seriesId, Type: 'Series', ProviderIds: { Tmdb: '9200' } })
        break
      case '/jellyfin/Sessions/Logout':
        expect(options.method).toBe('POST')
        expect(options.headers.get('Authorization')).toContain(`Token="${accessToken}"`)
        response = new Response(null, { status: 204 })
        break
      default:
        throw new Error(`Unexpected fixture request ${path}`)
    }
    return { destroy, response }
  })
  return { send, destroy }
}

it('checks the address before credentials and imports only watched marks with conditional Undo', async () => {
  const { send } = mockSource([
    movie(101, 9101),
    movie(102, 9101),
    movie(103, 9102, false),
    episode(104, 2),
    episode(105, 3),
    episode(106, 2, { IndexNumberEnd: 4 }),
    episode(107, 2, { ProviderIds: { Tmdb: '1234' } }),
  ])
  const connection = await connect()
  expect(connection).toMatchObject({ address: sourceUrl, addresses: [lan] })
  expect(send).not.toHaveBeenCalled()
  const insecure = await start(connection.id, {})
  expect(insecure.statusCode).toBe(422)
  expect(insecure.json()).toEqual({ kind: 'httpsRequired' })
  expect(send).not.toHaveBeenCalled()

  const started = await start(connection.id)
  expect(started.statusCode, started.body).toBe(202)
  const { id } = started.json<{ id: string }>()
  expect(await ready(id)).toMatchObject({
    state: 'ready',
    source: { server: 'Fixture Jellyfin', user: username },
    movies: { added: 1, existing: 0, skipped: 2 },
    episodes: { added: 1, existing: 0, skipped: 3 },
    skipped: { duplicate: 1, invalid: 2, unmatched: 2, restricted: 0 },
    lastActivityAt: '2020-01-02T12:00:00.000Z',
    logoutWarning: false,
  })
  expect(send.mock.calls.at(-1)?.[0].pathname).toBe('/jellyfin/Sessions/Logout')
  expect(getDb().select().from(diarySeen).all()).toEqual([])
  const crossSite = await request('GET', `/preview/${id}`, undefined, { 'origin': 'https://other.example', 'sec-fetch-site': 'cross-site' })
  expect(crossSite.statusCode).toBe(403)

  const applied = await request('POST', `/preview/${id}/apply`)
  expect(applied.statusCode, applied.body).toBe(200)
  expect(applied.json()).toMatchObject({
    id,
    imported: 2,
    unmatched: 0,
    history: { new: 0, seen: { new: 2, same: 0 }, skipped: 5 },
  })
  expect((await request('POST', `/preview/${id}/apply`)).json()).toEqual(applied.json())
  const browserCall = send.mock.calls.length
  const db = getDb()
  expect(db.select().from(diarySeen).all()).toMatchObject([
    { profileId, titleId: 'tmdb:movie:9101', season: 0, episode: 0 },
    { profileId, titleId: 'tmdb:tv:9200', season: 1, episode: 2 },
  ])
  expect(db.select().from(diaryEntries).all()).toEqual([])
  expect(db.select().from(titleProgress).all()).toEqual([])
  expect(db.select().from(cyclePlaybackFacts).all()).toEqual([])
  expect(db.select().from(profileImports).all()).toHaveLength(1)
  const provenance = db.select().from(profileImports).get()?.sources
  expect(provenance).toMatch(/^jellyfin:[0-9a-f]{64}$/)

  db.update(diarySeen).set({ season: 1 }).where(eq(diarySeen.titleId, 'tmdb:tv:9200')).run()
  const undo = await app.inject({
    method: 'POST',
    url: `/api/profiles/${profileId}/imports/${id}/undo`,
    cookies: { [ACCESS_TOKEN_COOKIE]: signToken('jellyfin-owner', 'user_access') },
  })
  expect(undo.statusCode, undo.body).toBe(200)
  expect(undo.json()).toEqual({ restored: 1, kept: 1 })
  expect(db.select().from(diarySeen).all()).toMatchObject([{ titleId: 'tmdb:tv:9200' }])
  expect(send).toHaveBeenCalledTimes(browserCall)
})

it('rejects an HTTP panel before resolving or contacting the HTTPS source', async () => {
  const { send } = mockSource()
  const dns = vi.mocked(netResolveDeps.routeAddresses)
  const challenge = await request('POST', '/connection', { url: sourceUrl }, {})
  expect(challenge.statusCode).toBe(422)
  expect(challenge.json()).toEqual({ kind: 'httpsRequired' })
  const preview = await request('POST', '/preview', {}, {})
  expect(preview.statusCode).toBe(422)
  expect(preview.json()).toEqual({ kind: 'httpsRequired' })
  expect(dns).not.toHaveBeenCalled()
  expect(send).not.toHaveBeenCalled()
})

it('blocks another profile and changed DNS before sending credentials', async () => {
  const connection = await connect()
  const { send } = mockSource()
  const other = await app.inject({
    method: 'POST',
    url: `/api/profiles/${anotherProfile}/imports/jellyfin/preview`,
    payload: { connectionId: connection.id, username, password: secret },
    headers: { 'x-forwarded-proto': 'https' },
    cookies: { [ACCESS_TOKEN_COOKIE]: signToken('jellyfin-owner', 'user_access') },
  })
  expect(other.statusCode).toBe(404)
  vi.mocked(netResolveDeps.routeAddresses).mockResolvedValue(['192.168.241.34'])
  const started = await start(connection.id)
  expect(await ready(started.json().id)).toMatchObject({ state: 'failed', error: 'addressChanged' })
  expect(send).not.toHaveBeenCalled()
})

it('rejects a changed playback mark between preview and apply without writing', async () => {
  mockSource([movie(101, 9101), movie(102, 9102)])
  const started = await start((await connect()).id)
  const { id } = started.json<{ id: string }>()
  expect((await ready(id)).state).toBe('ready')
  getDb().insert(diarySeen).values({ profileId, titleId: 'tmdb:movie:9101', season: 0, episode: 0 }).run()
  const res = await request('POST', `/preview/${id}/apply`)
  expect(res.statusCode).toBe(409)
  expect(res.json()).toEqual({ kind: 'profileChanged' })
  expect(getDb().select().from(diarySeen).all()).toMatchObject([{ titleId: 'tmdb:movie:9101' }])
  expect(getDb().select().from(profileImports).all()).toEqual([])
})

it('logs out with its own deadline after cancellation and discards the preview', async () => {
  const { send } = mockSource([], async (path, signal) => {
    if (path === '/jellyfin/Items') {
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    }
    return undefined
  })
  const response = await start((await connect()).id)
  const { id } = response.json<{ id: string }>()
  await vi.waitFor(() => expect(send.mock.calls.at(-1)?.[0].pathname).toBe('/jellyfin/Items'))
  expect((await request('DELETE', `/preview/${id}`)).statusCode).toBe(204)
  expect((await request('GET', `/preview/${id}`)).statusCode).toBe(404)
  await vi.waitFor(() => expect(send.mock.calls.at(-1)?.[0].pathname).toBe('/jellyfin/Sessions/Logout'))
  expect(send.mock.calls.at(-1)?.[2].signal.aborted).toBe(false)
})

it('does not follow a redirect or allow apply of an incomplete page', async () => {
  const { send } = mockSource([], async (path) => {
    if (path === '/jellyfin/Items')
      return new Response(null, { status: 302, headers: { location: 'https://other.example/' } })
  })
  const started = await start((await connect()).id)
  const { id } = started.json<{ id: string }>()
  expect(await ready(id)).toMatchObject({ state: 'failed', error: 'response', logoutWarning: false })
  expect(send.mock.calls.map(call => call[0].pathname)).toEqual([
    '/jellyfin/System/Info/Public',
    '/jellyfin/Users/AuthenticateByName',
    '/jellyfin/Users/Me',
    '/jellyfin/Items',
    '/jellyfin/Sessions/Logout',
  ])
  expect((await request('POST', `/preview/${id}/apply`)).statusCode).toBe(422)
  expect(getDb().select().from(diarySeen).all()).toEqual([])
})
