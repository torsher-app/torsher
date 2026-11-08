import type { SearchableIndexer } from '../indexers/index.ts'
import type { SearchTarget } from './search.ts'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { createApp } from '../../app.ts'
import { ACCESS_TOKEN_COOKIE } from '../../config.ts'
import { getDb, migrateDb } from '../../db/index.ts'
import { indexerManagers, indexers } from '../../db/schema.ts'
import { recordBackgroundOutcome } from '../indexers/backoff.ts'
import {
  closeLogFiles,
  createLogger,
  installLogger,
  queryLogs,
} from '../logs/index.ts'
import { projectRecord, projectRingEntry } from '../logs/reportProjection.ts'
import { LOG_RETENTION_MS } from '../logs/ring.ts'
import { setSetting } from '../settings/index.ts'
import { searchXml, torznabErrorXml } from '../torznab/fixtures/index.ts'
import { createOwner } from '../users/index.ts'
import { signToken } from '../../utils/token.ts'
import { cachedSearch, clearSearchCache } from './cache.ts'
import { searchReleases } from './search.ts'

const marker = 'PRIVATE_MARKER'
const fetchMock = vi.fn<typeof fetch>()
const app = createApp()
let owner = {}
let dir = ''
let stdout: string[] = []
function indexer(id: string): SearchableIndexer {
  return {
    id,
    name: `${marker} ${id}`,
    url: `https://${id}.example/${marker}`,
    apiKey: () => marker,
    caps: {
      search: { available: true, params: ['q'] },
      tvSearch: { available: false, params: [] },
      movieSearch: { available: false, params: [] },
      categories: [],
    },
  }
}
const target: SearchTarget = {
  titleId: 'tmdb:tv:101',
  identity: {
    kind: 'series',
    tmdbId: 101,
    year: 2023,
    names: [{ value: 'Quiet Harbor', kind: 'original', lang: 'en' }],
  },
  aliases: ['Quiet Harbor', `Alternate ${marker}`].map(value => ({
    titleId: 'tmdb:tv:101',
    value,
    normalized: value,
    kind: 'original',
    lang: 'en',
    syncedAt: new Date(0),
  })),
  season: 2,
}
function events(event: string) {
  return queryLogs({ level: 'debug', limit: 500 }).entries.filter(
    row => row.context?.event === event,
  )
}
async function assertPrivateFileAndReport() {
  await closeLogFiles()
  const disk = readFileSync(join(dir, 'torsher.log'), 'utf8')
  expect(stdout.join('')).not.toContain(marker)
  expect(disk).not.toContain(marker)
  const projected = disk
    .trim()
    .split('\n')
    .map(line =>
      projectRecord(JSON.parse(line), Date.now(), LOG_RETENTION_MS),
    )
  const ring = queryLogs({ level: 'debug', limit: 500 }).entries
  expect(JSON.stringify(ring)).not.toContain(marker)
  expect(JSON.stringify(projected)).not.toContain(marker)
  for (const entry of ring.filter(row =>
    row.context?.event?.toString().startsWith('sources.'),
  )) {
    const report = projectRingEntry(entry, Date.now(), LOG_RETENTION_MS)
    expect(report.kind).toBe('event')
    if (report.kind === 'event') {
      expect(report.value.origin).toBe('server')
      expect(projected).toContainEqual(report)
    }
  }
  return projected
}
beforeAll(async () => {
  await migrateDb()
  owner = {
    [ACCESS_TOKEN_COOKIE]: signToken(
      createOwner({ username: 'DiagnosticsOwner', passwordHash: 'x' }).id,
      'user_access',
    ),
  }
})
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  clearSearchCache()
  getDb().delete(indexers).run()
  getDb().delete(indexerManagers).run()
  setSetting('userActionDiagnostics', false)
  dir = mkdtempSync(join(tmpdir(), 'torsher-source-logs-'))
  stdout = []
  installLogger(
    createLogger({
      level: 'debug',
      logsDir: dir,
      stdout: { write: line => stdout.push(line) },
    }),
  )
})
afterEach(async () => {
  vi.unstubAllGlobals()
  await closeLogFiles()
  installLogger(pino({ level: 'silent' }))
  rmSync(dir, { recursive: true, force: true })
})

describe('source subsystem diagnostics', () => {
  it('counts distinct physically asked indexers and distinguishes empty success from failure and skipped', async () => {
    fetchMock.mockImplementation(async input =>
      String(input).includes('failed-001')
        ? new Response(torznabErrorXml(100, marker))
        : new Response('<rss><channel /></rss>'),
    )
    const unsupported = indexer('unsupported-001')
    unsupported.caps.search.available = false
    const outcome = await searchReleases(
      target,
      [indexer('failed-001'), indexer('empty-001'), unsupported],
      { skipped: 2 },
    )
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(outcome.diagnostics).toMatchObject({
      titleId: target.titleId,
      season: 2,
      asked: 2,
      ok: 1,
      failed: 1,
      skipped: 3,
      raw: 0,
      kept: 0,
      customQuery: false,
    })
    expect(outcome.failed.map(row => row.kind)).toEqual([
      'auth',
      'unsupported',
    ])
    expect(events('sources.indexer_failed')).toHaveLength(1)
    expect(events('sources.indexer_failed')[0]!.context).toMatchObject({
      indexerId: 'failed-001',
      errorKind: 'auth',
      status: 200,
      mode: 'text',
    })
    expect(events('sources.search')[0]!.message).toBe(
      'Source search: 1 of 2 indexers answered, 0 found, 0 kept',
    )
    await assertPrivateFileAndReport()
  })
  it('emits one warning for a partially successful indexer and merges raw hits before matching', async () => {
    const source = indexer('partial-001')
    source.caps.tvSearch = { available: true, params: ['tmdbid'] }
    fetchMock.mockImplementation(async input =>
      new URL(String(input)).searchParams.has('tmdbid')
        ? new Response(torznabErrorXml(410, marker), { status: 410 })
        : new Response(searchXml),
    )
    const outcome = await searchReleases(target, [source])
    expect(outcome.failed).toEqual([])
    expect(outcome.diagnostics).toMatchObject({
      asked: 1,
      ok: 1,
      failed: 0,
      raw: 2,
      kept: 2,
    })
    expect(events('sources.indexer_failed')).toHaveLength(1)
    expect(events('sources.indexer_failed')[0]!.context).toMatchObject({
      mode: 'id',
      errorKind: 'remote',
      status: 410,
    })
    await assertPrivateFileAndReport()
  })
  it.each(['success', 'failure'])(
    'freezes deadline counts and logs late only once after late %s',
    async (completion) => {
      let reject!: (reason: unknown) => void
      let resolve!: (response: Response) => void
      fetchMock.mockImplementation(
        () =>
          new Promise((ok, fail) => {
            reject = fail
            resolve = ok
          }),
      )
      const outcome = await searchReleases(
        target,
        [indexer('late-001'), indexer('queued-001')],
        { deadlineMs: 15, concurrency: 1 },
      )
      expect(outcome.failed[0]!.kind).toBe('timeout')
      expect(outcome.diagnostics).toMatchObject({
        asked: 1,
        ok: 0,
        failed: 1,
        skipped: 1,
        raw: 0,
        kept: 0,
      })
      const before = JSON.stringify(queryLogs({ level: 'debug' }).entries)
      expect(events('sources.indexer_failed')[0]!.context).toMatchObject({
        errorKind: 'late',
        mode: 'text',
      })
      if (completion === 'failure') {
        reject(
          new Error(`${marker} https://private.example/?apikey=${marker}`, {
            cause: new Error(marker),
          }),
        )
      }
      else {
        resolve(new Response(searchXml))
      }
      await new Promise(resolve => setTimeout(resolve, 10))
      expect(JSON.stringify(queryLogs({ level: 'debug' }).entries)).toBe(
        before,
      )
      expect(outcome.failed[0]!.kind).toBe('timeout')
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(outcome.releases).toEqual([])
      await assertPrivateFileAndReport()
    },
  )
  it('does not repeat the physical summary for cached or inflight full failures', async () => {
    let finish!: (response: Response) => void
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const load = () =>
      searchReleases({ ...target, query: marker }, [indexer('cached-001')])
    const first = cachedSearch('private-cache-key', load)
    const inflight = cachedSearch('private-cache-key', load)
    finish(new Response(torznabErrorXml(100, marker)))
    const [a, b] = await Promise.all([first, inflight])
    expect(a).toBe(b)
    const cached = await cachedSearch('private-cache-key', load)
    expect(cached).toBe(a)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(events('sources.search')).toHaveLength(1)
    expect(events('sources.indexer_failed')).toHaveLength(1)
    expect(events('sources.cache_hit')).toHaveLength(1)
    expect(events('sources.cache_hit')[0]!.context).toMatchObject({
      cached: true,
      asked: 1,
      ok: 0,
      failed: 1,
      customQuery: true,
    })
    await assertPrivateFileAndReport()
  })
  it('logs actual backoff steps and recovery, avoiding healthy resets', async () => {
    const source = indexer('backoff-001')
    getDb()
      .insert(indexers)
      .values({ id: source.id, name: source.name, url: source.url })
      .run()
    const failure = [{ id: source.id, kind: 'remote' as const }]
    const now = new Date()
    recordBackgroundOutcome([source], [], now)
    expect(events('sources.backoff_returned')).toHaveLength(0)
    recordBackgroundOutcome([source], failure, now)
    recordBackgroundOutcome([source], failure, new Date(now.getTime() + 60000))
    recordBackgroundOutcome(
      [source],
      [{ id: source.id, kind: 'unsupported' }],
      now,
    )
    expect(
      events('sources.backoff_paused').map(row => row.context?.failures),
    ).toEqual([2, 1])
    fetchMock.mockResolvedValue(new Response('<rss><channel /></rss>'))
    const outcome = await searchReleases(
      { ...target, aliases: [target.aliases[0]!] },
      [source],
    )
    recordBackgroundOutcome([source], outcome.failed)
    recordBackgroundOutcome([source], [])
    expect(events('sources.backoff_returned')).toHaveLength(1)
    expect(events('sources.backoff_returned')[0]!.context).toMatchObject({
      indexerId: source.id,
      failures: 2,
    })
    await assertPrivateFileAndReport()
  })
  it.each([
    [
      'indexer_add',
      '/api/indexers',
      {
        name: marker,
        url: `https://indexer.example/${marker}`,
        apiKey: marker,
      },
      200,
      'auth',
    ],
    [
      'manager_import',
      '/api/indexer-managers',
      {
        kind: 'jackett',
        url: `https://manager.example/${marker}`,
        apiKey: marker,
      },
      422,
      'remote',
    ],
  ] as const)(
    'logs safe %s classification and actual HTTP status while preserving the 422 response',
    async (operation, url, payload, status, errorKind) => {
      fetchMock.mockResolvedValue(
        new Response(torznabErrorXml(status === 200 ? 100 : 410, marker), {
          status,
        }),
      )
      const response = await app.inject({
        method: 'POST',
        url,
        cookies: owner,
        payload,
      })
      expect(response.statusCode).toBe(422)
      expect(response.json()).toEqual({
        message: `Torznab request failed (${errorKind})`,
        kind: errorKind,
      })
      expect(response.body).not.toContain(marker)
      expect(events('sources.check_failed')).toHaveLength(1)
      expect(events('sources.check_failed')[0]!.context).toMatchObject({
        operation,
        errorKind,
        status,
      })
      await assertPrivateFileAndReport()
    },
  )
  it('does not invent an HTTP status for network failures or leak their cause', async () => {
    fetchMock.mockRejectedValue(
      new Error(`${marker} https://private.example/${marker}`, {
        cause: new Error(marker),
      }),
    )
    const response = await app.inject({
      method: 'POST',
      url: '/api/indexers',
      cookies: owner,
      payload: { name: marker, url: `https://indexer.example/${marker}` },
    })
    expect(response.statusCode).toBe(422)
    expect(events('sources.check_failed')[0]!.context).toMatchObject({
      errorKind: 'unreachable',
    })
    expect(events('sources.check_failed')[0]!.context).not.toHaveProperty(
      'status',
    )
    await assertPrivateFileAndReport()
  })
  it('reports manager sync and persisted indexer checks without remote XML or names', async () => {
    const managerId = 'manager-001'
    getDb()
      .insert(indexerManagers)
      .values({
        id: managerId,
        kind: 'jackett',
        url: `https://manager.example/${marker}`,
        apiKey: 'invalid-cipher',
      })
      .run()
    const response = await app.inject({
      method: 'POST',
      url: `/api/indexer-managers/${managerId}/sync`,
      cookies: owner,
    })
    expect(response.statusCode).toBe(422)
    expect(events('sources.check_failed')[0]!.context).toMatchObject({
      operation: 'manager_sync',
      managerId,
      errorKind: 'auth',
    })
    const source = getDb()
      .insert(indexers)
      .values({ name: marker, url: `https://indexer.example/${marker}` })
      .returning()
      .get()
    fetchMock.mockResolvedValue(new Response(torznabErrorXml(100, marker)))
    const check = await app.inject({
      method: 'POST',
      url: `/api/indexers/${source.id}/test`,
      cookies: owner,
    })
    expect(check.statusCode).toBe(200)
    expect(check.json().checkStatus).toBe('auth')
    expect(events('sources.check_failed')[0]!.context).toMatchObject({
      operation: 'indexer_check',
      indexerId: source.id,
      status: 200,
    })
    await assertPrivateFileAndReport()
  })
})

describe('source report projection', () => {
  const safe = {
    time: Date.now() - 1,
    origin: 'server',
    source: 'sources',
    event: 'sources.check_failed',
    operation: 'indexer_add',
    errorKind: 'auth',
    status: 200,
  }
  it('exports only the exact source facts and drops raw names, details, messages and URLs', () => {
    const projected = projectRecord(
      {
        ...safe,
        name: marker,
        url: marker,
        msg: marker,
        details: marker,
        error: marker,
        cause: marker,
      },
      Date.now(),
      LOG_RETENTION_MS,
    )
    expect(projected).toMatchObject({
      kind: 'event',
      value: {
        facts: { operation: 'indexer_add', errorKind: 'auth', status: 200 },
      },
    })
    expect(JSON.stringify(projected)).not.toContain(marker)
  })
  it.each([
    { origin: 'client' },
    { source: 'network' },
    { status: '200' },
    { errorKind: marker },
    { operation: marker },
    { indexerId: `${marker}/path` },
  ])('rejects invalid source provenance or typed facts: %o', (override) => {
    expect(
      projectRecord({ ...safe, ...override }, Date.now(), LOG_RETENTION_MS)
        .kind,
    ).toBe('unstructured')
  })
})
