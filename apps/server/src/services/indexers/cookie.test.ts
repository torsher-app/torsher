import pino from 'pino'
import { eq } from 'drizzle-orm'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { getDb, migrateDb } from '../../db/index.ts'
import { indexerManagers, indexers, torrents } from '../../db/schema.ts'
import { readFeed } from '../follow/feed.ts'
import { installLogger } from '../logs/index.ts'
import { projectRecord } from '../logs/reportProjection.ts'
import { scrubText } from '../logs/scrub.ts'
import { searchReleases } from '../sources/search.ts'
import { acquire } from '../sources/watch.ts'
import * as torrentService from '../torrents/index.ts'
import { netResolveDeps } from '../net/index.ts'
import { capsXml, prowlarrIndexers } from '../torznab/fixtures/index.ts'
import {
  checkIndexer,
  createManualIndexer,
  importManager,
  indexerCookie,
  listFeedIndexers,
  listSearchableIndexers,
  syncManager,
  updateIndexer,
} from './index.ts'

const COOKIE = 'sid=synthetic-cookie-secret'
const fetchMock = vi.fn<typeof fetch>()
beforeAll(() => migrateDb())
beforeEach(() => {
  getDb().delete(indexers).run()
  getDb().delete(indexerManagers).run()
  getDb().delete(torrents).run()
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => new Response(capsXml))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  installLogger(pino({ level: 'silent' }))
})
async function create(name = 'Cookie A', sessionCookie = COOKIE) {
  return createManualIndexer({
    name,
    url: 'https://indexer.example/torznab',
    sessionCookie,
  })
}
function cookieAt(hop: number) {
  return new Headers(fetchMock.mock.calls[hop]![1]?.headers).get('cookie')
}

describe('stored Torznab cookie', () => {
  it('keeps two indexers on the same origin isolated and checks the expected origin', async () => {
    const a = await create()
    const b = await create('Cookie B', 'sid=second-secret')
    expect(indexerCookie(a.id, 'https://indexer.example')).toBe(COOKIE)
    expect(indexerCookie(b.id, 'https://indexer.example')).toBe(
      'sid=second-secret',
    )
    expect(indexerCookie(a.id, 'https://indexer.example:8443')).toBeUndefined()
    expect(indexerCookie(a.id, 'http://indexer.example')).toBeUndefined()
    expect(indexerCookie('missing', 'https://indexer.example')).toBeUndefined()
    updateIndexer(a.id, { sessionCookie: null })
    expect(indexerCookie(a.id, 'https://indexer.example')).toBeUndefined()
  })

  it('provides credentials lazily and sends them through both search and RSS', async () => {
    await create()
    const searchable = listSearchableIndexers()
    const feed = listFeedIndexers()
    fetchMock.mockClear()
    fetchMock.mockImplementation(
      async () => new Response('<rss><channel/></rss>'),
    )
    await searchReleases(
      {
        identity: {
          kind: 'series',
          tmdbId: 1,
          names: [{ value: 'Quiet Harbor', lang: 'en', kind: 'original' }],
        },
        aliases: [
          {
            titleId: 'tmdb:tv:1',
            value: 'Quiet Harbor',
            normalized: 'quietharbor',
            kind: 'original',
            lang: 'en',
            syncedAt: new Date(),
          },
        ],
      },
      searchable,
    )
    await readFeed(feed[0]!, async () => {})
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2)
    for (let hop = 0; hop < fetchMock.mock.calls.length; hop++)
      expect(cookieAt(hop)).toBe(COOKIE)
    getDb().update(indexers).set({ sessionCookie: 'broken' }).run()
    const broken = listSearchableIndexers()
    expect(() => broken[0]!.sessionCookie?.()).toThrow()
  })

  it('reads the current cookie for a saved release and refuses an origin mismatch', async () => {
    const indexer = await create()
    const torrent = getDb()
      .insert(torrents)
      .values({
        name: 'Synthetic',
        infoHash: 'a'.repeat(40),
        source: 'file',
        status: 'ready',
      })
      .returning()
      .get()
    vi.spyOn(torrentService, 'addTorrentFile').mockResolvedValue({
      torrent,
      created: false,
    })
    vi.spyOn(netResolveDeps, 'routeAddresses').mockResolvedValue([
      '203.0.113.10',
    ])
    const release = {
      title: 'Synthetic',
      link: {
        url: 'https://indexer.example/download',
        indexerId: indexer.id,
        indexerOrigin: 'https://indexer.example',
      },
    }
    updateIndexer(indexer.id, { sessionCookie: 'sid=replaced-secret' })
    fetchMock.mockClear()
    fetchMock.mockImplementation(async () => new Response('d1:ai1ee'))
    await acquire(release, () => true)
    expect(cookieAt(0)).toBe('sid=replaced-secret')
    expect(JSON.stringify(release)).not.toContain('replaced-secret')
    getDb()
      .update(indexers)
      .set({ url: 'https://changed.example/torznab' })
      .run()
    await acquire(release, () => true)
    expect(cookieAt(1)).toBeNull()
  })

  it.each(['sid=replacement', null])(
    'does not publish an old check after cookie replacement/removal: %s',
    async (sessionCookie) => {
      const indexer = await create()
      let finish!: (response: Response) => void
      fetchMock.mockImplementationOnce(
        async () =>
          new Promise<Response>((resolve) => {
            finish = resolve
          }),
      )
      const oldCheck = checkIndexer(indexer.id)
      updateIndexer(indexer.id, { sessionCookie })
      finish(new Response(capsXml))
      await oldCheck
      const row = getDb()
        .select()
        .from(indexers)
        .where(eq(indexers.id, indexer.id))
        .get()!
      expect(row.checkStatus).toBeNull()
      expect(row.checkedAt).toBeNull()
    },
  )

  it('preserves a managed cookie for the same origin and clears it when the origin changes', async () => {
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify(prowlarrIndexers)),
    )
    const result = await importManager({
      kind: 'prowlarr',
      url: 'http://manager.example:9696',
      apiKey: 'key',
    })
    const row = getDb().select().from(indexers).get()!
    updateIndexer(row.id, { sessionCookie: COOKIE })
    await syncManager(result.manager.id)
    expect(indexerCookie(row.id, 'http://manager.example:9696')).toBe(COOKIE)
    getDb()
      .update(indexers)
      .set({ url: 'http://old-origin.example/1' })
      .where(eq(indexers.id, row.id))
      .run()
    await syncManager(result.manager.id)
    expect(
      getDb().select().from(indexers).where(eq(indexers.id, row.id)).get()?.sessionCookie,
    ).toBeNull()
  })

  it.each(['transport', 'XML', 'HTML'] as const)(
    'does not log %s echoes or include secrets in reports',
    async (kind) => {
      const indexer = await create()
      const lines: string[] = []
      installLogger(
        pino(
          { level: 'warn' },
          { write: (value: string) => lines.push(value) },
        ),
      )
      fetchMock.mockImplementation(async () => {
        if (kind === 'transport')
          throw new Error(`Cookie: ${COOKIE}`)
        return new Response(
          kind === 'XML'
            ? `<error code="100" description="${COOKIE}"/>`
            : `<html>${COOKIE}</html>`,
        )
      })
      const checked = await checkIndexer(indexer.id)
      expect(checked?.checkStatus).not.toBe('ok')
      expect(lines.length).toBeGreaterThan(0)
      expect(lines.join('')).not.toContain('synthetic-cookie-secret')
      expect(
        scrubText(JSON.stringify({ headers: { cookie: COOKIE } })),
      ).not.toContain('synthetic-cookie-secret')
      const report = projectRecord(
        {
          time: Date.now(),
          level: 40,
          source: 'sources',
          msg: COOKIE,
          sessionCookie: COOKIE,
          headers: { cookie: COOKIE },
        },
        Date.now(),
        86400000,
      )
      expect(JSON.stringify(report)).not.toContain('synthetic-cookie-secret')
    },
  )
})
