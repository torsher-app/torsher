import type { SimklStatus } from '../dto/simkl.ts'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../app.ts'
import { ACCESS_TOKEN_COOKIE } from '../config.ts'
import { getDb, migrateDb } from '../db/index.ts'
import {
  cyclePlaybackFacts,
  diaryEntries,
  diarySeen,
  profiles,
  simklConnections,
  simklOutbox,
  simklReceipts,
  titleProgress,
  users,
} from '../db/schema.ts'
import { setNetTransport } from '../services/net/index.ts'
import { SimklSession, watchTime } from '../services/simkl/client.ts'
import {
  enqueueSimklCompletion,
  startSimklWorker,
  stopSimklWorker,
} from '../services/simkl/index.ts'
import { deliver } from '../services/simkl/sync.ts'
import { getTitleSummary, tmdbEpisodeExists } from '../services/tmdb/index.ts'
import { signToken } from '../utils/token.ts'

vi.mock('../services/tmdb/index.ts', async (actual) => {
  const original = await actual<typeof import('../services/tmdb/index.ts')>()
  return { ...original, getTitleSummary: vi.fn(), tmdbEpisodeExists: vi.fn() }
})

const actor = 'simkl-owner'
const profileId = 'simkl-profile'
const anotherProfile = 'simkl-other'
const route = `/api/profiles/${profileId}/simkl`
const accountId = 9451231
const movieId = 9903001
const providerMovieId = 9903002
const movieKey = { profileId, titleId: `tmdb:movie:${movieId}`, season: 0, episode: 0 }
const watchedAt = '2026-11-28T08:00:00Z'
const access = 'synthetic-access-token'
const refresh = 'synthetic-refresh-token'
const device = 'synthetic-device-code'
const providerNow = '2026-11-28T08:00:01Z'

let app: ReturnType<typeof createApp>
let calls: Array<{ path: string, body: string | undefined, authorization: string | null, dateFrom: string | null }>
let grantScope: string
let currentToken: string
let providerAccount: { id: number, name: string }
let activities: unknown
let library: unknown
let appendBody: unknown
let refreshes: number
let failRefresh: boolean
let limitLookup: 'rate_limit' | 'user_limit_exceeded' | undefined
let releaseWrite: (() => void) | undefined
let didWrite: (() => void) | undefined

function respond(value?: unknown, status = 200) {
  return new Response(value === undefined ? null : JSON.stringify(value), { status })
}

beforeAll(async () => {
  await migrateDb()
  getDb().insert(users).values({ id: actor, username: 'Fixture owner', passwordHash: 'hash' }).run()
})

beforeEach(() => {
  vi.stubEnv('SIMKL_CLIENT_ID', 'synthetic-client')
  vi.stubEnv('TORSHER_SECRET', 'synthetic-encryption-key')
  vi.mocked(getTitleSummary).mockImplementation(async id => ({ details: { id } }) as Awaited<ReturnType<typeof getTitleSummary>>)
  vi.mocked(tmdbEpisodeExists).mockResolvedValue(true)
  app = createApp()
  calls = []
  grantScope = 'media:read'
  currentToken = access
  providerAccount = { id: accountId, name: 'Fixture viewer' }
  library = {}
  activities = { all: null, tv_shows: null, movies: null }
  appendBody = { added: { movies: 1, episodes: 0 } }
  refreshes = 0
  failRefresh = false
  limitLookup = undefined
  releaseWrite = undefined
  didWrite = undefined
  getDb().insert(profiles).values([
    { id: profileId, name: 'First', color: 'blue', position: 0 },
    { id: anotherProfile, name: 'Second', color: 'blue', position: 1 },
  ]).run()
  setNetTransport(async (input, init) => {
    const url = new URL(input)
    expect(url.origin).toBe('https://api.simkl.com')
    const path = url.pathname
    const body = typeof init.body === 'string' ? init.body : undefined
    const form = new URLSearchParams(body)
    const authorization = new Headers(init.headers).get('authorization')
    calls.push({ path, body, authorization, dateFrom: url.searchParams.get('date_from') })
    if (path.startsWith('/oauth2/'))
      expect(form.get('client_id')).toBe('synthetic-client')
    else
      expect(url.searchParams.get('client_id')).toBe('synthetic-client')
    switch (path) {
      case '/oauth2/device':
        grantScope = form.get('scope')!
        expect(authorization).toBeNull()
        return respond({
          device_code: device,
          user_code: 'TEST-CODE',
          verification_uri: 'https://simkl.com/pin',
          interval: 1,
          expires_in: 300,
        })
      case '/oauth2/token': {
        const grantType = form.get('grant_type')
        if (grantType === 'refresh_token') {
          expect(form.get('refresh_token')).toBe(refresh)
          refreshes++
          if (failRefresh) {
            failRefresh = false
            return respond({ error: 'fixture_unavailable' }, 503)
          }
          currentToken = 'refreshed-synthetic-token'
        }
        else {
          expect(grantType).toBe('urn:ietf:params:oauth:grant-type:device_code')
          expect(form.get('device_code')).toBe(device)
        }
        return respond({
          access_token: currentToken,
          refresh_token: refresh,
          scope: grantScope,
          expires_in: 3600,
        })
      }
      case '/oauth2/revoke':
        expect(form.get('token')).toBe(refresh)
        return respond(undefined, 200)
      case '/users/settings':
        expect(authorization).toBe(`Bearer ${currentToken}`)
        return respond({ user: { name: providerAccount.name }, account: { id: providerAccount.id } })
      case '/sync/activities':
        return respond(activities)
      case '/sync/all-items/movies':
        expect(init.method).toBe('GET')
        expect(body).toBeUndefined()
        return respond(library)
      case '/sync/all-items/shows':
        expect(init.method).toBe('GET')
        expect(body).toBeUndefined()
        expect(url.searchParams.get('extended')).toBe('full')
        expect(url.searchParams.get('include_all_episodes')).toBe('original')
        expect(url.searchParams.get('episode_watched_at')).toBe('yes')
        return respond({})
      case '/search/id':
        return respond([{ type: 'movie', ids: { tmdb: movieId, simkl: providerMovieId } }])
      case '/sync/watched':
        if (limitLookup) {
          const error = limitLookup
          limitLookup = undefined
          return new Response(JSON.stringify({ error }), { status: 429, headers: { 'Retry-After': '3600' } })
        }
        return respond([{ result: true, simkl: providerMovieId, last_watched_at: watchedAt }])
      case '/sync/history':
        didWrite?.()
        if (didWrite)
          await new Promise<void>(resolve => releaseWrite = resolve)
        return respond(appendBody, 201)
      default:
        throw new Error('Unexpected simulated endpoint')
    }
  })
})

afterEach(async () => {
  releaseWrite?.()
  await stopSimklWorker()
  await app.close()
  setNetTransport(null)
  getDb().delete(profiles).run()
  vi.unstubAllEnvs()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function request(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', suffix = '', payload?: object, id = profileId) {
  return app.inject({
    method,
    url: `/api/profiles/${id}/simkl${suffix}`,
    cookies: { [ACCESS_TOKEN_COOKIE]: signToken(actor, 'user_access') },
    payload,
  })
}

async function status() {
  return (await request('GET')).json<SimklStatus>()
}

async function setDirections(values: { push: boolean, pull: boolean }, expectedGeneration?: string) {
  const generation = expectedGeneration ?? (await status()).connection!.generation
  return request('PATCH', '', { ...values, expectedGeneration: generation })
}

async function link(scope: 'read' | 'write', id?: string) {
  const now = Date.now()
  const pending = await request('POST', '/device', { scope }, id)
  expect(pending.statusCode, pending.body).toBe(200)
  expect(pending.headers['cache-control']).toBe('no-store')
  expect(pending.body).not.toContain(device)
  expect(pending.json<SimklStatus>().challenge?.userCode).toBe('TEST-CODE')
  // Poll interval is sent by the provider. Reads from the API never poll it.
  expect((await request('POST', '/device/poll', undefined, id)).json<SimklStatus>().challenge).not.toBeNull()
  vi.setSystemTime(now + 1600)
  return request('POST', '/device/poll', undefined, id)
}

async function pullDone() {
  return vi.waitFor(async () => {
    const value = await status()
    expect(value.syncing, calls.map(call => call.path).join(', ')).toBe(false)
    expect(value.syncError).toBe(false)
    expect(value.lastSyncAt).not.toBeNull()
    return value
  }, { timeout: 5000 })
}

function enqueue(attempt: string, at = Date.parse(watchedAt)) {
  const date = new Date(at)
  const db = getDb()
  db.transaction(() => {
    const row = db.insert(diaryEntries).values({
      ...movieKey,
      precision: 'instant',
      instant: date,
      origin: 'playback',
      originKey: attempt,
      createdAt: date,
      updatedAt: date,
    }).returning({ id: diaryEntries.id }).get()
    enqueueSimklCompletion(movieKey, attempt, row.id, at)
  })
}

describe('profile Simkl API', () => {
  it('keeps OAuth internals off the wire, separates write authorization from sending and locally detaches before revoke', async () => {
    expect((await app.inject({ method: 'GET', url: route })).statusCode).toBe(401)
    const response = await link('write')
    expect(response.statusCode, response.body).toBe(200)
    expect(response.body).not.toContain(access)
    expect(response.body).not.toContain(refresh)
    expect(response.json<SimklStatus>().connection).toMatchObject({ account: 'Fixture viewer', pull: false, push: false })
    expect(getDb().select().from(simklConnections).get()!.grant).not.toContain(access)

    enqueue('before-opt-in')
    expect(getDb().select().from(simklOutbox).all()).toHaveLength(0)
    expect((await setDirections({ push: true, pull: false })).statusCode).toBe(200)
    enqueue('after-opt-in')
    expect(getDb().select().from(simklOutbox).all()).toHaveLength(1)

    expect((await link('write')).statusCode).toBe(200)
    expect(calls.filter(item => item.path === '/oauth2/revoke')).toHaveLength(0)
    expect((await link('write', anotherProfile)).statusCode).toBe(409)
    expect(calls.filter(item => item.path === '/oauth2/revoke')).toHaveLength(0)

    expect((await request('DELETE')).json<SimklStatus>().connection).toBeNull()
    expect(getDb().select().from(simklOutbox).all()).toHaveLength(0)
    expect(calls.filter(item => item.path === '/oauth2/revoke')).toHaveLength(1)
  })

  it('rejects directions confirmed against a replaced provider account', async () => {
    expect((await link('write')).statusCode).toBe(200)
    const original = (await status()).connection!
    providerAccount = { id: accountId + 1, name: 'Other fixture viewer' }
    expect((await link('write')).statusCode).toBe(200)

    const replaced = (await status()).connection!
    expect(replaced.generation).not.toBe(original.generation)
    expect(replaced).toMatchObject({ account: 'Other fixture viewer', push: false, pull: false })

    const stale = await setDirections({ push: true, pull: true }, original.generation)
    expect(stale.statusCode).toBe(409)
    expect(stale.json()).toEqual({ kind: 'identity' })
    expect((await status()).connection).toEqual(replaced)
    expect((await setDirections({ push: true, pull: false }, replaced.generation)).statusCode).toBe(200)
  })

  it('starts from the empty activity baseline, persists a delta receipt and preserves an explicit local removal', async () => {
    expect((await link('read')).statusCode).toBe(200)
    expect((await setDirections({ push: true, pull: false })).statusCode).toBe(422)
    await setDirections({ push: false, pull: true })
    await pullDone()

    library = { movies: [{ status: 'completed', movie: { ids: { simkl: providerMovieId, tmdb: movieId } }, last_watched_at: watchedAt }] }
    activities = { all: providerNow, movies: { all: providerNow }, tv_shows: { all: null } }
    vi.setSystemTime(Date.now() + 31_000)
    await request('POST', '/sync', { mode: 'manual' })
    await pullDone()

    const first = getDb().select().from(diaryEntries).get()
    expect(first).toMatchObject({ origin: 'simkl', titleId: movieKey.titleId, instant: new Date(watchedAt), rewatch: false })
    expect(getDb().select().from(diarySeen).all()).toHaveLength(1)
    expect(getDb().select().from(titleProgress).all()).toHaveLength(0)
    expect(getDb().select().from(cyclePlaybackFacts).all()).toHaveLength(0)

    getDb().delete(diaryEntries).run()
    getDb().delete(diarySeen).run()
    vi.setSystemTime(Date.now() + 31_000)
    await request('POST', '/sync', { mode: 'full' })
    await pullDone()
    expect(getDb().select().from(diaryEntries).all()).toHaveLength(0)
    expect(getDb().select().from(diarySeen).all()).toHaveLength(0)
    expect(getDb().select().from(simklReceipts).all()).toHaveLength(1)
  })

  it('preserves per-title order and consumes an exact push echo without inventing another diary row', async () => {
    const previousActivity = '2026-11-28T07:45:30.123Z'
    const showActivity = { all: '2026-11-28T07:40:00Z' }
    activities = { all: previousActivity, movies: { all: previousActivity }, tv_shows: showActivity }
    expect((await link('write')).statusCode).toBe(200)
    await setDirections({ push: true, pull: true })
    await pullDone()
    enqueue('first')
    enqueue('repeat', Date.parse(watchedAt) + 60_000)
    const db = getDb()
    db.update(simklOutbox).set({ state: 'attention' }).where(eq(simklOutbox.attemptId, 'first')).run()
    vi.setSystemTime(Date.parse(watchedAt) + 62_000)
    startSimklWorker()
    // Allow the scheduler microtask to run. The newer attempt is due but blocked.
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(calls.some(call => call.path === '/sync/history')).toBe(false)
    await stopSimklWorker()
    await request('POST', '/retry')
    await pullDone()
    startSimklWorker()
    await vi.waitFor(() => {
      expect(db.select().from(simklReceipts).get()).toMatchObject({ kind: 'push' })
    }, { timeout: 5000 })

    const requests = calls.filter(call => call.path === '/sync/history')
    expect(requests).toHaveLength(1)
    expect(JSON.parse(requests[0]!.body!)).toEqual({
      movies: [{ ids: { simkl: providerMovieId }, watched_at: new Date(watchedAt).toISOString() }],
    })
    const diary = db.select().from(diaryEntries).where(eq(diaryEntries.originKey, 'first')).get()
    const receipt = db.select().from(simklReceipts).get()
    expect(receipt?.diaryId).toBe(diary?.id)
    await stopSimklWorker()

    library = { movies: [{ status: 'completed', movie: { ids: { simkl: providerMovieId, tmdb: movieId } }, last_watched_at: watchedAt }] }
    activities = { all: providerNow, movies: { all: providerNow }, tv_shows: showActivity }
    vi.setSystemTime(Date.now() + 31_000)
    const beforeDelta = calls.length
    await request('POST', '/sync', { mode: 'manual' })
    await pullDone()
    const deltaRequests = calls.slice(beforeDelta).filter(call => call.path.startsWith('/sync/all-items/'))
    expect(deltaRequests).toMatchObject([{ path: '/sync/all-items/movies', dateFrom: previousActivity }])
    expect(db.select().from(diaryEntries).all()).toHaveLength(2)
    expect(db.select().from(simklReceipts).all()).toHaveLength(1)
  })

  it('recovers a dispatched row by exact provider date instead of resending it after restart', async () => {
    await link('write')
    await setDirections({ push: true, pull: false })
    enqueue('same-completion')
    const db = getDb()
    db.update(simklOutbox).set({ dispatched: true, state: 'sending', simklId: providerMovieId }).run()
    db.update(simklConnections).set({ expiresAt: Date.now() - 1 }).run()
    vi.setSystemTime(Date.parse(watchedAt) + 60_000)
    startSimklWorker()
    await vi.waitFor(() => {
      expect(db.select().from(simklOutbox).all()).toHaveLength(0)
    })
    expect(refreshes).toBe(1)
    expect(calls.some(call => call.path === '/sync/history')).toBe(false)
    expect(db.select().from(simklReceipts).get()).toMatchObject({ kind: 'push', watchedAt: Date.parse(watchedAt) })
    expect(db.select().from(diaryEntries).all()).toHaveLength(1)
  })

  it.each([
    { code: 'rate_limit', delay: 1500 },
    { code: 'user_limit_exceeded', delay: 3_600_000 },
  ] as const)('keeps a persisted dispatch uncertain after $code and waits for the correct retry', async ({ code, delay }) => {
    vi.setSystemTime(Date.parse(watchedAt) + 1000)
    await link('write')
    await setDirections({ push: true, pull: false })
    enqueue('awaiting-evidence')
    const db = getDb()
    db.update(simklOutbox).set({ dispatched: true, state: 'sending', simklId: providerMovieId }).run()
    const task = db.select().from(simklOutbox).get()!
    const connection = db.select().from(simklConnections).get()!
    db.insert(simklReceipts).values({
      profileId,
      accountFingerprint: connection.accountFingerprint,
      remoteKey: `${providerMovieId}:movie`,
      diaryId: task.diaryId,
      titleId: task.titleId,
      kind: 'dispatch',
      watchedAt: task.watchedAt,
    }).run()

    limitLookup = code
    const startedAt = Date.now()
    startSimklWorker()
    await vi.waitFor(() => {
      expect(db.select().from(simklOutbox).get()).toMatchObject({
        state: 'uncertain',
        dispatched: true,
        nextTryAt: startedAt + delay,
      })
      expect(db.select().from(simklConnections).get()?.blockedUntil).toBe(startedAt + delay)
    }, { timeout: 5000 })
    expect(db.select().from(simklReceipts).get()).toMatchObject({ kind: 'dispatch' })
    await stopSimklWorker()
    vi.setSystemTime(startedAt + delay - 1)
    startSimklWorker()
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(calls.filter(call => call.path === '/sync/watched')).toHaveLength(1)
    await stopSimklWorker()
    vi.setSystemTime(startedAt + delay)

    startSimklWorker()
    await vi.waitFor(() => {
      expect(db.select().from(simklOutbox).all()).toHaveLength(0)
    }, { timeout: 5000 })
    expect(calls.filter(call => call.path === '/sync/watched')).toHaveLength(2)
    expect(calls.filter(call => call.path === '/sync/history')).toHaveLength(0)
    expect(db.select().from(simklReceipts).get()).toMatchObject({ kind: 'push', diaryId: task.diaryId })
  })

  it('persists per-job retry after a failed shared token refresh and keeps older dispatches uncertain', async () => {
    vi.setSystemTime(Date.parse(watchedAt) + 1000)
    await link('write')
    await setDirections({ push: true, pull: false })
    enqueue('dispatch-before-refresh')
    const db = getDb()
    db.update(simklOutbox).set({ dispatched: true, state: 'sending', simklId: providerMovieId }).run()
    db.update(simklConnections).set({ expiresAt: Date.now() - 1 }).run()
    failRefresh = true

    startSimklWorker()
    await vi.waitFor(() => {
      expect(db.select().from(simklOutbox).get()).toMatchObject({
        retries: 1,
        state: 'uncertain',
        dispatched: true,
      })
    }, { timeout: 5000 })
    expect(refreshes).toBe(1)
    expect(calls.filter(call => call.path === '/sync/watched')).toHaveLength(0)
    await stopSimklWorker()

    const next = db.select().from(simklOutbox).get()!.nextTryAt
    expect(next).toBeGreaterThan(Date.now() + 30_000)
    vi.setSystemTime(next - 1000)
    startSimklWorker()
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(refreshes).toBe(1)
    await stopSimklWorker()

    vi.setSystemTime(next + 1000)
    startSimklWorker()
    await vi.waitFor(() => {
      expect(db.select().from(simklOutbox).all()).toHaveLength(0)
    }, { timeout: 5000 })
    expect(refreshes).toBe(2)
    expect(calls.filter(call => call.path === '/sync/watched')).toHaveLength(1)
    expect(calls.filter(call => call.path === '/sync/history')).toHaveLength(0)
  })

  it('queues the first pull if the owner opts in during an active push', async () => {
    await link('write')
    await setDirections({ push: true, pull: false })
    enqueue('in-flight-while-enabling-pull', Date.now() - 1000)

    const posted = new Promise<void>(resolve => didWrite = resolve)
    startSimklWorker()
    await posted
    const enabled = await setDirections({ push: true, pull: true })
    expect(enabled.json<SimklStatus>()).toMatchObject({
      connection: { push: true, pull: true },
      syncing: true,
    })
    expect(calls.some(call => call.path === '/sync/activities')).toBe(false)
    releaseWrite?.()
    await pullDone()
    expect(calls.filter(call => call.path === '/sync/activities')).toHaveLength(1)
  })

  it('does not use an old dispatch result to restore an unlinked connection or its receipts', async () => {
    await link('write')
    await setDirections({ push: true, pull: false })
    enqueue('in-flight')
    const db = getDb()
    const posted = new Promise<void>(resolve => didWrite = resolve)
    const connection = db.select().from(simklConnections).get()!
    const row = db.select().from(simklOutbox).where(and(
      eq(simklOutbox.profileId, profileId),
      eq(simklOutbox.attemptId, 'in-flight'),
    )).get()!
    const abort = new AbortController()
    const write = deliver(connection, row, new SimklSession('synthetic-client', access, abort.signal), abort.signal).catch(() => {})
    await posted
    await request('DELETE')
    releaseWrite?.()
    await write
    expect(db.select().from(simklOutbox).all()).toHaveLength(0)
    expect(db.select().from(simklConnections).all()).toHaveLength(0)
    expect(db.select().from(diaryEntries).all()).toHaveLength(1)
    expect(db.select().from(simklReceipts).get()).toMatchObject({ kind: 'dispatch' })
  })
})

it('preserves finite early dates and translates only the canonical Simkl date sentinel to unknown', () => {
  expect(watchTime('1967-11-12T08:30:00Z')).toBe(Date.parse('1967-11-12T08:30:00Z'))
  expect(watchTime('1970-01-01T00:00:00Z')).toBe(0)
  expect(watchTime('1970-01-01T01:00:01.000+01:00')).toBeNull()
  expect(watchTime('invalid')).toBeNull()
  expect(watchTime(null)).toBeNull()
})
