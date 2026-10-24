import type { Torrent } from '../../db/schema.ts'
import { Buffer } from 'node:buffer'
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
import { getDb, migrateDb } from '../../db/index.ts'
import { storagePolicy, torrents } from '../../db/schema.ts'
import { setEngineDown, setEngineReady } from '../engine/index.ts'
import {
  engineError,
  INFO_HASH,
  liveState,
  movieDetails,
  sampleTorrentFile,
} from '../engine/fixtures/index.ts'
import { installLogger } from '../logs/index.ts'
import { volumeDeps } from './folders.ts'
import {
  enforceStorage,
  ensureSpaceFor,
  GIB,
  InsufficientStorageError,
} from './index.ts'

const OTHER_HASH = 'fedcba9876543210fedcba9876543210fedcba98'
const ROOT = '/srv/torsher-volumes'
const disks = vi.hoisted(() => ({
  a: { total: 0, free: 0 },
  b: { total: 0, free: 0 },
}))

vi.mock('./disk.ts', () => ({
  diskUsage: async (path: string) => {
    if (path.startsWith('/srv/torsher-volumes/c'))
      throw Object.assign(new Error('stale'), { code: 'ESTALE' })

    return path.startsWith('/srv/torsher-volumes/b')
      ? { ...disks.b }
      : { ...disks.a }
  },
}))

const fetchMock = vi.fn<typeof fetch>()
const volumeKey = volumeDeps.volumeKey

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function engine(live: object[]) {
  fetchMock.mockImplementation(async (input, init = {}) => {
    const url = new URL(String(input))
    const method = init.method ?? 'GET'

    if (method === 'GET' && url.pathname === '/torrents')
      return json(live)

    if (method === 'DELETE')
      return json({ deletedBytes: 0 })

    if (method === 'POST' && /\/(?:pause|resume)$/.test(url.pathname))
      return new Response(null, { status: 204 })

    return json(engineError('torrent_not_found', 'torrent not found'), 404)
  })
}

function engineCalls() {
  return fetchMock.mock.calls
    .map(
      ([input, init]) =>
        `${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`,
    )
    .filter(call => call !== 'GET /torrents')
}

function insertTorrent(values: Partial<typeof torrents.$inferInsert>): Torrent {
  return getDb()
    .insert(torrents)
    .values({
      infoHash: INFO_HASH,
      name: 'Sample Movie (2008)',
      source: 'file',
      torrentFile: Buffer.from(sampleTorrentFile()),
      files: movieDetails.files.map(item => ({
        path: item.path,
        size: item.length,
        padding: item.padding,
      })),
      pieceLength: 262_144,
      status: 'ready',
      inEngine: true,
      lastAccessAt: new Date('2026-01-01'),
      ...values,
    })
    .returning()
    .get()
}

function rowOf(id: string) {
  return getDb()
    .select()
    .from(torrents)
    .all()
    .find(row => row.id === id)!
}

beforeAll(() => {
  migrateDb()
})

beforeEach(() => {
  vi.stubEnv('DOWNLOADS_PATH', join(ROOT, 'a'))
  volumeDeps.volumeKey = async path =>
    path.startsWith(join(ROOT, 'b'))
      ? 'b'
      : path.startsWith(join(ROOT, 'c'))
        ? 'c'
        : 'a'
  disks.a = { total: 100 * GIB, free: 50 * GIB }
  disks.b = { total: 100 * GIB, free: 50 * GIB }
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  setEngineReady('http://127.0.0.1:4000')
  getDb().delete(torrents).run()
  getDb().delete(storagePolicy).run()
})

afterEach(() => {
  volumeDeps.volumeKey = volumeKey
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  setEngineDown('stopped')
  installLogger(pino({ level: 'silent' }))
})

describe('место по томам', () => {
  it('кэш на другом томе не освобождает место на томе просмотра', async () => {
    // Запас по умолчанию — 10 ГиБ на томе в 100 ГиБ
    disks.a.free = 12 * GIB
    const cached = insertTorrent({
      infoHash: OTHER_HASH,
      downloadDir: join(ROOT, 'b'),
    })
    const watched = insertTorrent({ inEngine: false })

    engine([{ ...liveState, infoHash: OTHER_HASH, bytesCompleted: 40 * GIB }])

    await expect(
      ensureSpaceFor({ torrent: watched, bytes: 5 * GIB }),
    ).rejects.toBeInstanceOf(InsufficientStorageError)
    expect(engineCalls()).toEqual([])
    expect(rowOf(cached.id).inEngine).toBe(true)
  })

  it('раздача на прежнем томе: места не хватает именно там', async () => {
    disks.b.free = 11 * GIB
    const old = insertTorrent({ downloadDir: join(ROOT, 'b') })

    engine([{ ...liveState }])

    const error = await ensureSpaceFor({ torrent: old, bytes: 5 * GIB }).catch(
      (err: unknown) => err,
    )

    expect(error).toBeInstanceOf(InsufficientStorageError)
    expect((error as InsufficientStorageError).shortage).toMatchObject({
      kind: 'no_space',
      free: 11 * GIB,
      minFree: 10 * GIB,
    })

    // На действующем томе места хватает: новая раздача стартует
    const fresh = insertTorrent({ infoHash: OTHER_HASH, inEngine: false })

    await expect(
      ensureSpaceFor({ torrent: fresh, bytes: 5 * GIB }),
    ).resolves.toBeUndefined()
  })

  it('пауза из-за места — только у раздач полного тома', async () => {
    disks.a.free = 5 * GIB
    const full = insertTorrent({ retention: 'keep' })
    const roomy = insertTorrent({
      infoHash: OTHER_HASH,
      retention: 'keep',
      downloadDir: join(ROOT, 'b'),
    })

    engine([{ ...liveState }, { ...liveState, infoHash: OTHER_HASH }])

    await enforceStorage()

    expect(rowOf(full.id).pauseReason).toBe('storage')
    expect(rowOf(roomy.id).pauseReason).toBeNull()
    expect(engineCalls()).toEqual([`POST /torrents/${INFO_HASH}/pause`])
  })

  describe('недоступный том', () => {
    const STALE_HASH = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'

    it('раздачи на нём не мешают паузе на полном томе', async () => {
      disks.a.free = 5 * GIB
      const full = insertTorrent({ retention: 'keep' })
      const stale = insertTorrent({
        infoHash: STALE_HASH,
        retention: 'keep',
        downloadDir: join(ROOT, 'c'),
      })

      engine([{ ...liveState }, { ...liveState, infoHash: STALE_HASH }])

      await enforceStorage()

      expect(rowOf(full.id).pauseReason).toBe('storage')
      expect(rowOf(stale.id).pauseReason).toBeNull()
      expect(engineCalls()).toEqual([`POST /torrents/${INFO_HASH}/pause`])
    })

    it('просмотр на живом томе стартует', async () => {
      const watched = insertTorrent({})
      const stale = insertTorrent({
        infoHash: STALE_HASH,
        downloadDir: join(ROOT, 'c'),
      })

      engine([
        { ...liveState },
        { ...liveState, infoHash: STALE_HASH, bytesCompleted: 90 * GIB },
      ])

      await expect(
        ensureSpaceFor({ torrent: watched, bytes: GIB }),
      ).resolves.toBeUndefined()
      expect(engineCalls()).toEqual([])
      expect(rowOf(stale.id).inEngine).toBe(true)
    })

    it('просмотр на недоступном томе отклоняется ошибкой диска', async () => {
      const stale = insertTorrent({
        infoHash: STALE_HASH,
        downloadDir: join(ROOT, 'c'),
      })

      engine([{ ...liveState, infoHash: STALE_HASH }])

      const error = await ensureSpaceFor({ torrent: stale, bytes: GIB }).catch(
        (err: unknown) => err,
      )

      expect(error).not.toBeInstanceOf(InsufficientStorageError)
      expect(error).toMatchObject({ code: 'ESTALE' })
    })
  })
})
