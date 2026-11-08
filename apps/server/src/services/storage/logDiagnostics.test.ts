import type { Torrent } from '../../db/schema.ts'
import { Buffer } from 'node:buffer'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import process from 'node:process'
import { eq } from 'drizzle-orm'
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
import { serverSettings, storagePolicy, torrents } from '../../db/schema.ts'
import { setEngineDown, setEngineReady } from '../engine/index.ts'
import {
  INFO_HASH,
  movieDetails,
  sampleTorrentFile,
} from '../engine/fixtures/index.ts'
import {
  closeLogFiles,
  createLogger,
  installLogger,
  queryLogs,
} from '../logs/index.ts'
import { projectRecord, projectRingEntry } from '../logs/reportProjection.ts'
import { LOG_RETENTION_MS } from '../logs/ring.ts'
import { setSetting } from '../settings/index.ts'
import { resolveTorrent } from '../torrents/index.ts'
import * as storageMove from './move.ts'
import { volumeDeps } from './folders.ts'
import { createOwner } from '../users/index.ts'
import { signToken } from '../../utils/token.ts'

const disk = vi.hoisted(() => ({ total: 100 * 1024 ** 3, free: 0 }))
vi.mock('./disk.ts', () => ({ diskUsage: async () => ({ ...disk }) }))
const marker = 'PRIVATE_MARKER'
const app = createApp()
const fetchMock = vi.fn<typeof fetch>()
const originalVolumeKey = volumeDeps.volumeKey
let owner = {}
let root = ''
let stdout: string[] = []
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
function row(overrides: Partial<typeof torrents.$inferInsert> = {}): Torrent {
  return getDb()
    .insert(torrents)
    .values({
      infoHash: INFO_HASH,
      name: marker,
      source: 'file',
      status: 'ready',
      torrentFile: Buffer.from(sampleTorrentFile()),
      pieceLength: movieDetails.pieceLength,
      files: movieDetails.files.map(file => ({
        path: `${marker}/${file.path}`,
        size: file.length,
        padding: file.padding,
      })),
      ...overrides,
    })
    .returning()
    .get()
}
function events(event: string) {
  return queryLogs({ level: 'debug', limit: 500 }).entries.filter(
    entry => entry.context?.event === event,
  )
}
async function privateFileAndReport() {
  await closeLogFiles()
  const file = readFileSync(join(root, 'logs', 'torsher.log'), 'utf8')
  expect(stdout.join('')).not.toContain(marker)
  expect(file).not.toContain(marker)
  const projections = file
    .trim()
    .split('\n')
    .map(line =>
      projectRecord(JSON.parse(line), Date.now(), LOG_RETENTION_MS),
    )
  const ring = queryLogs({ level: 'debug', limit: 500 }).entries
  expect(JSON.stringify(ring)).not.toContain(marker)
  expect(JSON.stringify(projections)).not.toContain(marker)
  for (const entry of ring.filter(entry =>
    [
      'storage.metadata_failed',
      'storage.insufficient_space',
      'storage.folder_rejected',
      'engine.request_failed',
    ].includes(String(entry.context?.event)),
  )) {
    const projected = projectRingEntry(entry, Date.now(), LOG_RETENTION_MS)
    expect(projected.kind).toBe('event')
    if (projected.kind === 'event') {
      // Disk keeps original repetitions; ring may combine identical records.
      const { repeat: _, ...value } = projected.value
      expect(projections).toContainEqual({ kind: 'event', value })
    }
  }
}
beforeAll(async () => {
  await migrateDb()
  owner = {
    [ACCESS_TOKEN_COOKIE]: signToken(
      createOwner({ username: 'StorageDiagnosticOwner', passwordHash: 'x' }).id,
      'user_access',
    ),
  }
})
beforeEach(() => {
  getDb().delete(torrents).run()
  getDb().delete(storagePolicy).run()
  getDb().delete(serverSettings).run()
  root = mkdtempSync(join(tmpdir(), 'torsher-storage-diag-'))
  vi.stubEnv('DOWNLOADS_PATH', join(root, marker, 'downloads'))
  vi.stubEnv('LIBRARY_PATH', join(root, marker, 'library'))
  mkdirSync(join(root, marker, 'downloads'), { recursive: true })
  mkdirSync(join(root, marker, 'library'), { recursive: true })
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => json([]))
  disk.free = 0
  setEngineReady('http://127.0.0.1:4000')
  setSetting('userActionDiagnostics', false)
  stdout = []
  installLogger(
    createLogger({
      level: 'debug',
      logsDir: join(root, 'logs'),
      stdout: { write: line => stdout.push(line) },
    }),
  )
})
afterEach(async () => {
  volumeDeps.volumeKey = originalVolumeKey
  await closeLogFiles()
  installLogger(pino({ level: 'silent' }))
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  setEngineDown('stopped')
  rmSync(root, { recursive: true, force: true })
})
describe('storage failure diagnostics', () => {
  it('records a real metadata HTTP504 failure through the add route without changing its result', async () => {
    fetchMock.mockResolvedValue(
      json({ kind: 'timeout', message: `${marker} magnet:?PRIVATE` }, 504),
    )
    const response = await app.inject({
      method: 'POST',
      url: '/api/torrents',
      cookies: owner,
      payload: { magnet: `magnet:?xt=urn:btih:${INFO_HASH}&dn=${marker}` },
    })
    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({
      status: 'failed',
      error: 'timeout',
    })
    const event = events('storage.metadata_failed')[0]!
    expect(event.context).toMatchObject({
      torrentId: response.json().id,
      infoHash: INFO_HASH,
      reason: 'timeout',
    })
    expect(queryLogs({ q: INFO_HASH }).entries).toContainEqual(event)
    await privateFileAndReport()
  })
  it.each(['timeout', 'rejected', 'failed', 'hash_mismatch'])(
    'logs background metadata %s only after its failed outcome',
    async (reason) => {
      const torrent = row({
        source: 'magnet',
        magnet: `magnet:?xt=urn:btih:${INFO_HASH}&dn=${marker}`,
        status: 'resolving',
        torrentFile: null,
        files: null,
      })
      fetchMock.mockImplementation(async (input) => {
        if (new URL(String(input)).pathname.endsWith('/resolve')) {
          return reason === 'hash_mismatch'
            ? new Response(sampleTorrentFile())
            : json(
                { kind: reason, message: marker },
                reason === 'timeout' ? 504 : reason === 'rejected' ? 400 : 500,
              )
        }
        return json({
          ...movieDetails,
          infoHash: 'a'.repeat(40),
          name: marker,
        })
      })
      await resolveTorrent(torrent.id)
      expect(getDb().select().from(torrents).get()).toMatchObject({
        status: 'failed',
        error: reason === 'hash_mismatch' ? 'rejected' : reason,
      })
      expect(events('storage.metadata_failed')).toHaveLength(1)
      expect(events('storage.metadata_failed')[0]!.context).toMatchObject({
        torrentId: torrent.id,
        infoHash: INFO_HASH,
        reason,
      })
      await privateFileAndReport()
    },
  )
  it('keeps resolving across engine unavailability without a false metadata failure', async () => {
    const torrent = row({
      source: 'magnet',
      magnet: `magnet:?xt=urn:btih:${INFO_HASH}`,
      status: 'resolving',
      torrentFile: null,
    })
    setEngineDown('starting')
    await resolveTorrent(torrent.id)
    expect(getDb().select().from(torrents).get()?.status).toBe('resolving')
    expect(events('storage.metadata_failed')).toEqual([])
  })
  it.each(['timeout', 'hash_mismatch'])(
    'does not claim a metadata failure for a deleted row after %s',
    async (reason) => {
      const torrent = row({
        source: 'magnet',
        magnet: `magnet:?xt=urn:btih:${INFO_HASH}`,
        status: 'resolving',
        torrentFile: null,
      })
      let finish!: (value: Response) => void
      fetchMock.mockImplementation(async input =>
        new URL(String(input)).pathname.endsWith('/resolve')
          ? new Promise((resolve) => {
              finish = resolve
            })
          : json({ ...movieDetails, infoHash: 'a'.repeat(40) }),
      )
      const pending = resolveTorrent(torrent.id)
      await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
      getDb().delete(torrents).where(eq(torrents.id, torrent.id)).run()
      finish(
        reason === 'timeout'
          ? json({ kind: 'timeout', message: marker }, 504)
          : new Response(sampleTorrentFile()),
      )
      await pending
      expect(events('storage.metadata_failed')).toEqual([])
      expect(getDb().select().from(torrents).all()).toEqual([])
    },
  )
  it('logs one typed polling failure using the confirmed row and the original engine status', async () => {
    const torrent = row()
    fetchMock.mockImplementation(async () =>
      json(
        { kind: marker, message: `${marker} path/secret`, cause: marker },
        500,
      ),
    )
    for (let i = 0; i < 2; i++) {
      const response = await app.inject({
        url: `/api/torrents/${torrent.id}/stats?fileIndex=0`,
        cookies: owner,
      })
      expect(response.statusCode).toBe(502)
      expect(response.json().message).toContain(marker)
    }
    expect(events('engine.request_failed')).toHaveLength(1)
    expect(events('engine.request_failed')[0]!.context).toMatchObject({
      operation: 'getTorrentStats',
      errorKind: 'failed',
      status: 500,
      torrentId: torrent.id,
      infoHash: INFO_HASH,
    })
    expect(
      queryLogs({ q: torrent.id }).entries.some(
        entry => entry.context?.event === 'engine.request_failed',
      ),
    ).toBe(true)
    await privateFileAndReport()
  })
  it('records restart unavailability on debug and does not invent HTTP status', async () => {
    const torrent = row()
    setEngineDown('starting')
    const response = await app.inject({
      url: `/api/torrents/${torrent.id}/stats?fileIndex=0`,
      cookies: owner,
    })
    expect(response.statusCode).toBe(503)
    const event = events('engine.request_failed')[0]!
    expect(event.level).toBe('debug')
    expect(event.context).toMatchObject({
      errorKind: 'unavailable',
      unavailable: 'starting',
    })
    expect(event.context).not.toHaveProperty('status')
    await privateFileAndReport()
  })
  it('preserves stream507 and emits one shortage without generic engine duplicates or raw playback error', async () => {
    const torrent = row()
    for (let i = 0; i < 2; i++) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/playback',
        cookies: owner,
        payload: { torrentId: torrent.id, fileIndex: 0 },
      })
      expect(response.statusCode).toBe(507)
      expect(response.json()).toMatchObject({
        kind: 'no_space',
        needed: 9_437_184,
        available: 0,
        free: 0,
      })
    }
    expect(events('storage.insufficient_space')).toHaveLength(1)
    expect(events('storage.insufficient_space')[0]!.context).toMatchObject({
      torrentId: torrent.id,
      infoHash: INFO_HASH,
      kind: 'stream',
      shortage: 'no_space',
      needed: 9_437_184,
      free: 0,
    })
    expect(events('engine.request_failed')).toHaveLength(0)
    await privateFileAndReport()
  })
  it('preserves download507 on isolation admission after actual engine path conflict', async () => {
    const torrent = row()
    // GET /torrents is a snapshot, POST /torrents is the conflicting add.
    fetchMock.mockImplementation(async (input, init) =>
      init?.method === 'POST'
        ? json({ kind: 'storage_path_conflict', message: marker }, 409)
        : json([]),
    )
    const response = await app.inject({
      method: 'POST',
      url: `/api/torrents/${torrent.id}/download`,
      cookies: owner,
      payload: { files: [0] },
    })
    expect(response.statusCode).toBe(507)
    expect(response.json()).toMatchObject({
      kind: 'no_space',
      needed: 9_437_184,
    })
    expect(events('storage.insufficient_space')[0]!.context).toMatchObject({
      kind: 'download',
      torrentId: torrent.id,
      infoHash: INFO_HASH,
    })
    expect(events('engine.request_failed')).toHaveLength(0)
    expect(getDb().select().from(torrents).get()!.downloadDir).toContain(
      `/torsher/${INFO_HASH}`,
    )
    await privateFileAndReport()
  })
  it('keeps playback context while projecting an engine error to safe fields', async () => {
    const torrent = row()
    fetchMock.mockResolvedValue(json({ kind: marker, message: marker }, 500))
    const response = await app.inject({
      method: 'POST',
      url: '/api/playback',
      cookies: owner,
      payload: { torrentId: torrent.id, fileIndex: 0 },
    })
    expect(response.statusCode).toBe(502)
    expect(response.json().message).toBe(marker)
    expect(events('engine.request_failed')[0]!.context).toMatchObject({
      operation: 'postPlayback',
      infoHash: INFO_HASH,
    })
    await privateFileAndReport()
  })
  it('logs folder422 with the observed probe errno and uid/gid, without publishing internal errno in check API', async () => {
    const path = join(root, marker, 'denied')
    mkdirSync(path)
    chmodSync(path, 0o555)
    try {
      const checked = await app.inject({
        method: 'POST',
        url: '/api/storage/check',
        cookies: owner,
        payload: { kind: 'downloads', path },
      })
      expect(checked.statusCode).toBe(200)
      expect(checked.json()).not.toHaveProperty('errorCode')
      const response = await app.inject({
        method: 'PUT',
        url: '/api/storage/paths',
        cookies: owner,
        payload: { kind: 'downloads', path, mode: 'new_only' },
      })
      expect(response.statusCode).toBe(422)
      expect(response.json()).toEqual({
        kind: 'denied',
        message: 'Storage path rejected: denied',
      })
      const event = events('storage.folder_rejected')[0]!
      expect(event.context).toMatchObject({
        setting: 'downloads',
        errorKind: 'denied',
        errno: 'EACCES',
        uid: process.getuid!(),
        gid: process.getgid!(),
      })
      await privateFileAndReport()
    }
    finally {
      chmodSync(path, 0o755)
    }
  })
  it('reports actual move422 no_space through the existing volume admission', async () => {
    volumeDeps.volumeKey = async path => path
    const torrent = row({ inEngine: true })
    const { liveState } = await import('../engine/fixtures/index.ts')
    fetchMock.mockImplementation(async () =>
      json([
        {
          ...liveState,
          infoHash: torrent.infoHash,
          bytesCompleted: 1024 * 1024,
        },
      ]),
    )
    const response = await app.inject({
      method: 'PUT',
      url: '/api/storage/paths',
      cookies: owner,
      payload: {
        kind: 'downloads',
        path: join(root, 'new-volume'),
        mode: 'move',
      },
    })
    expect(response.statusCode).toBe(422)
    expect(response.json()).toEqual({
      message: 'Not enough space',
      kind: 'no_space',
    })
    expect(events('storage.folder_rejected')).toHaveLength(1)
    expect(events('storage.folder_rejected')[0]!.context).toMatchObject({
      setting: 'downloads',
      errorKind: 'no_space',
      errno: 'unknown',
    })
    await privateFileAndReport()
  })

  it.each([
    [new storageMove.StorageMoveError('busy'), 409],
    [Object.assign(new Error('Synthetic IO failure'), { code: 'EIO' }), 500],
  ] as const)(
    'does not classify %s as a folder422 rejection',
    async (failure, status) => {
      const path = join(root, 'new-storage')
      vi.spyOn(storageMove, 'changeStoragePath').mockRejectedValueOnce(failure)
      const response = await app.inject({
        method: 'PUT',
        url: '/api/storage/paths',
        cookies: owner,
        payload: { kind: 'downloads', path, mode: 'new_only' },
      })
      expect(response.statusCode).toBe(status)
      expect(events('storage.folder_rejected')).toHaveLength(0)
    },
  )

  it('does not invent errno for a policy rejection', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/storage/paths',
      cookies: owner,
      payload: { kind: 'library', path: marker, mode: 'new_only' },
    })
    expect(response.statusCode).toBe(422)
    expect(events('storage.folder_rejected')[0]!.context).toMatchObject({
      setting: 'library',
      errorKind: 'not_absolute',
      errno: 'unknown',
    })
    await privateFileAndReport()
  })
})

describe('storage report boundaries', () => {
  const safe = {
    time: Date.now() - 1,
    source: 'storage',
    origin: 'server',
    event: 'storage.metadata_failed',
    torrentId: 'torrent-1234',
    infoHash: INFO_HASH,
    reason: 'timeout',
    elapsedMs: 5000,
  }
  it('strips raw messages/details/cause even from otherwise valid facts', () => {
    const report = projectRecord(
      {
        ...safe,
        name: marker,
        path: marker,
        err: marker,
        cause: marker,
        details: marker,
        msg: marker,
      },
      Date.now(),
      LOG_RETENTION_MS,
    )
    expect(report.kind).toBe('event')
    expect(JSON.stringify(report)).not.toContain(marker)
  })
  it.each([
    { source: 'engine' },
    { origin: 'client' },
    { reason: marker },
    { infoHash: marker },
    { elapsedMs: '5000' },
    { elapsedMs: -1 },
  ])('rejects invalid provenance and typed fields: %o', (override) => {
    expect(
      projectRecord({ ...safe, ...override }, Date.now(), LOG_RETENTION_MS)
        .kind,
    ).toBe('unstructured')
  })
})
