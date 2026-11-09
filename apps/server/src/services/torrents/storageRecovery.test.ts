import { Buffer } from 'node:buffer'
import { join } from 'node:path'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { getDb, migrateDb } from '../../db/index.ts'
import { torrents } from '../../db/schema.ts'
import { setEngineDown, setEngineReady } from '../engine/index.ts'
import {
  INFO_HASH,
  liveStats,
  movieDetails,
  sampleTorrentFile,
} from '../engine/fixtures/index.ts'
import { ensureSpaceFor } from '../storage/index.ts'
import { torrentDir } from '../storage/paths.ts'
import {
  downloadFiles,
  getTorrent,
  prepareStream,
  reconcileEngineStorage,
} from './index.ts'

vi.mock('../storage/index.ts', () => ({
  ensureSpaceFor: vi.fn(async () => {}),
  enforceStorage: vi.fn(async () => {}),
}))

const fetchMock = vi.fn<typeof fetch>()
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
function row(values: Partial<typeof torrents.$inferInsert> = {}) {
  return getDb()
    .insert(torrents)
    .values({
      infoHash: INFO_HASH,
      name: 'Synthetic Movie',
      source: 'file',
      status: 'ready',
      torrentFile: Buffer.from(sampleTorrentFile()),
      files: movieDetails.files.map(file => ({
        path: file.path,
        size: file.length,
        padding: file.padding,
      })),
      ...values,
    })
    .returning()
    .get()
}
beforeAll(async () => {
  await migrateDb()
})
beforeEach(() => {
  getDb().delete(torrents).run()
  fetchMock.mockReset()
  vi.mocked(ensureSpaceFor).mockReset().mockResolvedValue(undefined)
  vi.stubGlobal('fetch', fetchMock)
  setEngineReady('http://127.0.0.1:4000')
})
afterEach(() => {
  vi.unstubAllGlobals()
  setEngineDown('stopped')
})

it('persists isolation before retry and a stale concurrent playback reuses it', async () => {
  const torrent = row()
  const root = torrentDir(torrent)
  const isolated = join(root, 'torsher', INFO_HASH)
  const dirs: Array<string | null> = []
  fetchMock.mockImplementation(async (input, init = {}) => {
    const url = new URL(String(input))
    if (init.method === 'POST' && url.pathname === '/torrents') {
      dirs.push(url.searchParams.get('dir'))
      if (dirs.length === 1) {
        return json(
          { kind: 'storage_path_conflict', message: 'conflict' },
          409,
        )
      }
      expect(getTorrent(torrent.id)?.downloadDir).toBe(isolated)
      return json({ ...movieDetails, dir: isolated })
    }
    return json(liveStats)
  })
  const results = await Promise.all([
    prepareStream(torrent, 0),
    prepareStream(torrent, 0),
  ])
  expect(dirs).toEqual([null, isolated, isolated])
  expect(
    results.every(
      result => result.downloadDir === isolated && result.inEngine,
    ),
  ).toBe(true)
  expect(ensureSpaceFor).toHaveBeenCalledWith(
    expect.objectContaining({
      bytes: movieDetails.files[0]!.length,
      torrent: expect.objectContaining({ downloadDir: isolated }),
    }),
  )
})

it('keeps isolation across a failed retry, without nesting the next attempt', async () => {
  const torrent = row()
  let calls = 0
  fetchMock.mockImplementation(async (input, init = {}) => {
    if (
      init.method === 'POST'
      && new URL(String(input)).pathname === '/torrents'
    ) {
      calls++
      return json(
        {
          kind: calls === 1 ? 'storage_path_conflict' : 'unavailable',
          message: 'failure',
        },
        calls === 1 ? 409 : 503,
      )
    }
    return json(liveStats)
  })
  await expect(prepareStream(torrent, 0)).rejects.toThrow()
  const isolated = getTorrent(torrent.id)!.downloadDir!
  expect(isolated).toBe(join(torrentDir(torrent), 'torsher', INFO_HASH))
  expect(getTorrent(torrent.id)?.inEngine).toBe(false)
  fetchMock.mockImplementation(async (input, init = {}) => {
    const url = new URL(String(input))
    if (init.method === 'POST') {
      expect(url.searchParams.get('dir')).toBe(isolated)
      return json({ ...movieDetails, dir: isolated })
    }
    return json(liveStats)
  })
  expect((await prepareStream(torrent, 0)).downloadDir).toBe(isolated)
})

it('uses actual engine directory after a previously accepted add lost its response', async () => {
  const torrent = row({ downloadDir: '/requested' })
  fetchMock.mockImplementation(async (_input, init = {}) =>
    json(
      init.method === 'POST' ? { ...movieDetails, dir: '/actual' } : liveStats,
    ),
  )
  expect((await prepareStream(torrent, 0)).downloadDir).toBe('/actual')
  expect(getTorrent(torrent.id)?.downloadDir).toBe('/actual')
})

it('recovers known paused conflicts before producers and preserves selection, priority and retention', async () => {
  const torrent = row({
    inEngine: true,
    retention: 'keep',
    pauseReason: 'user',
    selectedFiles: [0, 2],
    firstFiles: [2],
    lowFiles: [0],
  })
  const inventory = [
    {
      infoHash: INFO_HASH,
      dir: '/old',
      state: 'conflict',
      conflictingHashes: ['a'.repeat(40)],
    },
    {
      infoHash: 'a'.repeat(40),
      dir: '/old',
      state: 'conflict',
      conflictingHashes: [INFO_HASH],
    },
  ]
  const adds: URL[] = []
  fetchMock.mockImplementation(async (input, init = {}) => {
    const url = new URL(String(input))
    if (url.pathname === '/torrents/storage')
      return json(inventory)
    expect(url.pathname).toBe('/torrents')
    expect(init.method).toBe('POST')
    adds.push(url)
    return json({ ...movieDetails, dir: url.searchParams.get('dir') })
  })
  await reconcileEngineStorage()
  expect(adds).toHaveLength(1)
  expect(adds[0]!.searchParams.get('paused')).toBe('true')
  expect(adds[0]!.searchParams.get('first')).toBe('2')
  expect(adds[0]!.searchParams.get('low')).toBe('0')
  expect(getTorrent(torrent.id)).toMatchObject({
    downloadDir: `/old/torsher/${INFO_HASH}`,
    pauseReason: 'user',
    retention: 'keep',
    selectedFiles: [0, 2],
    firstFiles: [2],
    lowFiles: [0],
  })
  expect(ensureSpaceFor).toHaveBeenCalledWith(
    expect.objectContaining({
      bytes: movieDetails.files[0]!.length + movieDetails.files[2]!.length,
    }),
  )
})

it('synchronizes an active directory without downloading an unknown DB session', async () => {
  const torrent = row({ downloadDir: '/stale' })
  fetchMock.mockImplementation(async () =>
    json([
      {
        infoHash: INFO_HASH,
        dir: '/actual',
        state: 'active',
        conflictingHashes: [],
      },
      {
        infoHash: 'b'.repeat(40),
        dir: '/unknown',
        state: 'conflict',
        conflictingHashes: [],
      },
    ]),
  )
  await reconcileEngineStorage()
  expect(getTorrent(torrent.id)).toMatchObject({
    downloadDir: '/actual',
    inEngine: true,
  })
  expect(
    fetchMock.mock.calls.every(
      ([input]) => new URL(String(input)).pathname === '/torrents/storage',
    ),
  ).toBe(true)
})

it.each(['space', 'add'])(
  'defers one %s failure, continues healthy recovery and retries on the next storage check',
  async (failure) => {
    const blocked = row({ selectedFiles: [0] })
    const healthy = row({ infoHash: 'c'.repeat(40), selectedFiles: [0] })
    const inventory = [blocked, healthy].map(torrent => ({
      infoHash: torrent.infoHash,
      dir: '/old',
      state: 'conflict',
      conflictingHashes: [],
      paused: true,
    }))
    let failing = true
    const added: string[] = []
    vi.mocked(ensureSpaceFor).mockImplementation(async ({ torrent }) => {
      if (failure === 'space' && failing && torrent.id === blocked.id)
        throw new Error('no space')
    })
    fetchMock.mockImplementation(async (input, init = {}) => {
      const url = new URL(String(input))
      if (url.pathname === '/torrents/storage')
        return json(inventory)
      if (url.pathname.endsWith('/resume'))
        return new Response(null, { status: 204 })
      if (init.method === 'POST' && url.pathname === '/torrents') {
        const hash = url.searchParams.get('dir')!.split('/').pop()!
        if (failure === 'add' && failing && hash === blocked.infoHash)
          return json({ kind: 'storage', message: 'storage unavailable' }, 500)
        added.push(hash)
        const item = inventory.find(item => item.infoHash === hash)!
        item.state = 'active'
        item.paused = false
        return json({
          ...movieDetails,
          infoHash: hash,
          dir: url.searchParams.get('dir'),
        })
      }
      return json(liveStats)
    })
    await expect(reconcileEngineStorage()).resolves.toBeUndefined()
    expect(added).toEqual([healthy.infoHash])
    expect(getTorrent(healthy.id)?.inEngine).toBe(true)
    expect(getTorrent(blocked.id)?.downloadDir).toBe(
      `/old/torsher/${INFO_HASH}`,
    )
    failing = false
    await reconcileEngineStorage()
    expect(added).toEqual([healthy.infoHash, blocked.infoHash])
    expect(getTorrent(blocked.id)?.inEngine).toBe(true)
  },
)

it('repairs a durable paused add interrupted before resume, while preserving user pause intent', async () => {
  const recovering = row({ selectedFiles: [0] })
  const userPaused = row({ infoHash: 'd'.repeat(40), pauseReason: 'user' })
  const inventory = [
    {
      infoHash: recovering.infoHash,
      dir: '/old',
      state: 'conflict',
      conflictingHashes: [],
      paused: true,
    },
    {
      infoHash: userPaused.infoHash,
      dir: '/user',
      state: 'active',
      conflictingHashes: [],
      paused: true,
    },
  ]
  let resumeAttempts = 0
  fetchMock.mockImplementation(async (input) => {
    const url = new URL(String(input))
    if (url.pathname === '/torrents/storage')
      return json(inventory)
    if (url.pathname.endsWith('/stats'))
      return json(liveStats)
    if (url.pathname.endsWith('/resume')) {
      expect(url.pathname).toContain(recovering.infoHash)
      if (++resumeAttempts === 1)
        return json({ kind: 'unavailable', message: 'restart' }, 503)
      inventory[0]!.paused = false
      return new Response(null, { status: 204 })
    }
    inventory[0]!.state = 'active'
    inventory[0]!.dir = url.searchParams.get('dir')!
    return json({ ...movieDetails, dir: inventory[0]!.dir, paused: true })
  })
  await reconcileEngineStorage()
  expect(resumeAttempts).toBe(1)
  expect(getTorrent(recovering.id)?.pauseReason).toBeNull()
  expect(inventory[0]!.paused).toBe(true)
  await reconcileEngineStorage()
  expect(resumeAttempts).toBe(2)
  expect(inventory[0]!.paused).toBe(false)
  expect(getTorrent(userPaused.id)?.pauseReason).toBe('user')
})

it('explicit PLAY resumes an engine technical pause even when DB has no pauseReason', async () => {
  const torrent = row({ inEngine: true })
  let resumed = false
  fetchMock.mockImplementation(async (input, init = {}) => {
    const url = new URL(String(input))
    if (url.pathname.endsWith('/resume')) {
      resumed = true
      return new Response(null, { status: 204 })
    }
    return json(
      init.method === 'POST' ? { ...movieDetails, paused: true } : liveStats,
    )
  })
  await prepareStream(torrent, 0)
  expect(resumed).toBe(true)
})

it('sends draft priorities with the first download request and persists them', async () => {
  const torrent = row()
  const adds: URL[] = []
  fetchMock.mockImplementation(async (input, init = {}) => {
    const url = new URL(String(input))
    if (init.method === 'POST' && url.pathname === '/torrents') {
      adds.push(url)
      return json(movieDetails)
    }
    return json(liveStats)
  })
  const updated = await downloadFiles(torrent, [0, 2], {
    priorities: [
      { index: 2, priority: 'high' },
      { index: 0, priority: 'low' },
    ],
  })
  expect(adds).toHaveLength(1)
  expect(adds[0]!.searchParams.get('first')).toBe('2')
  expect(adds[0]!.searchParams.get('low')).toBe('0')
  expect(updated).toMatchObject({
    firstFiles: [2],
    lowFiles: [0],
    retention: 'keep',
  })
})

it.each([undefined, []])(
  'preserves saved priorities without overrides (%s)',
  async (priorities) => {
    const torrent = row({
      selectedFiles: [0, 2],
      firstFiles: [2],
      lowFiles: [0],
    })
    fetchMock.mockImplementation(async (input, init = {}) => {
      const url = new URL(String(input))
      if (init.method === 'POST' && url.pathname === '/torrents') {
        expect(url.searchParams.get('first')).toBe('2')
        expect(url.searchParams.get('low')).toBe('0')
        return json(movieDetails)
      }
      return json(liveStats)
    })
    expect(await downloadFiles(torrent, [0, 2], { priorities })).toMatchObject({
      firstFiles: [2],
      lowFiles: [0],
    })
  },
)

it('clears an explicit medium override and retains priorities of other selected files', async () => {
  const torrent = row({
    selectedFiles: [0, 2],
    firstFiles: [2],
    lowFiles: [0],
  })
  fetchMock.mockImplementation(async (input, init = {}) => {
    const url = new URL(String(input))
    if (init.method === 'POST' && url.pathname === '/torrents') {
      expect(url.searchParams.get('first')).toBe('2')
      expect(url.searchParams.has('low')).toBe(false)
      return json(movieDetails)
    }
    return json(liveStats)
  })
  expect(
    await downloadFiles(torrent, [0, 2], {
      priorities: [{ index: 0, priority: 'medium' }],
    }),
  ).toMatchObject({ firstFiles: [2], lowFiles: null })
})

it('leaves saved selection and priorities intact when the download request fails', async () => {
  const torrent = row({ selectedFiles: [0], firstFiles: [0] })
  fetchMock.mockImplementation(async () =>
    json({ kind: 'unavailable', message: 'failure' }, 503),
  )
  await expect(
    downloadFiles(torrent, [0, 2], {
      priorities: [
        { index: 2, priority: 'high' },
        { index: 0, priority: 'low' },
      ],
    }),
  ).rejects.toThrow()
  expect(getTorrent(torrent.id)).toMatchObject({
    selectedFiles: [0],
    firstFiles: [0],
    lowFiles: null,
  })
})
