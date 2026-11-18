import type { Torrent } from '../db/schema.ts'
import { Buffer } from 'node:buffer'
import {
  copyFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  statfs,
  symlink,
  truncate,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
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
import { createApp } from '../app.ts'
import { ACCESS_TOKEN_COOKIE, config } from '../config.ts'
import { getDb, migrateDb } from '../db/index.ts'
import {
  libraries,
  libraryFolders,
  mediaFiles,
  serverSettings,
  storageMoves,
  torrents,
  users,
} from '../db/schema.ts'
import { setEngineDown, setEngineReady } from '../services/engine/index.ts'
import {
  engineError,
  INFO_HASH,
  liveState,
  moveState,
  movieDetails,
  sampleTorrentFile,
} from '../services/engine/fixtures/index.ts'
import { managedFolder, managedFolders } from '../services/library/files.ts'
import { currentLinkMode, linkDeps } from '../services/library/link.ts'
import { installLogger } from '../services/logs/index.ts'
import { volumeDeps } from '../services/storage/folders.ts'
import {
  cancelMove,
  moveIdle,
  resumeMoves,
  storageMoveState,
} from '../services/storage/move.ts'
import {
  onStoragePathsChanged,
  setStoragePath,
  storagePath,
} from '../services/storage/paths.ts'
import { reconcileEngineStorage } from '../services/torrents/index.ts'
import { signToken } from '../utils/token.ts'

const app = createApp()
const fetchMock = vi.fn<typeof fetch>()
const owner = { [ACCESS_TOKEN_COOKIE]: signToken('owner', 'user_access') }
const volumeKey = volumeDeps.volumeKey
vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...fs,
    lstat: vi.fn(fs.lstat),
    rename: vi.fn(fs.rename),
    unlink: vi.fn(fs.unlink),
    statfs: vi.fn(fs.statfs),
    stat: vi.fn(fs.stat),
    writeFile: vi.fn(fs.writeFile),
  }
})
let root = ''

type Route = (url: URL, init: RequestInit) => Response | Promise<Response>

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Подменённый движок: ответы по методу и пути запроса */
function engine(live: object[], routes: Record<string, Route> = {}) {
  const all: Record<string, Route> = {
    'GET /torrents': () => json(live),
    ...routes,
  }

  fetchMock.mockImplementation(async (input, init = {}) => {
    const url = new URL(String(input))
    const route = all[`${init.method ?? 'GET'} ${url.pathname}`]

    if (!route)
      return json(engineError('torrent_not_found', 'torrent not found'), 404)

    return route(url, init)
  })
}

function engineCalls() {
  return fetchMock.mock.calls
    .map(([input, init]) => {
      const url = new URL(String(input))
      return `${init?.method ?? 'GET'} ${url.pathname}${decodeURIComponent(url.search)}`
    })
    .filter(call => call !== 'GET /torrents')
}

function insertTorrent(
  values: Partial<typeof torrents.$inferInsert> = {},
): Torrent {
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
      ...values,
    })
    .returning()
    .get()
}

function torrentRow(id: string) {
  return getDb()
    .select()
    .from(torrents)
    .all()
    .find(row => row.id === id)!
}

async function putPath(payload: object) {
  return app.inject({
    method: 'PUT',
    url: '/api/storage/paths',
    cookies: owner,
    payload,
  })
}

async function overview() {
  return (await app.inject({ url: '/api/storage', cookies: owner })).json()
}

beforeAll(() => {
  migrateDb()
  getDb()
    .insert(users)
    .values({
      id: 'owner',
      username: 'Owner',
      passwordHash: 'hash',
    })
    .run()
})

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'torsher-storage-'))
  vi.stubEnv('DOWNLOADS_PATH', join(root, 'torrents'))
  vi.stubEnv('LIBRARY_PATH', join(root, 'library'))
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  setEngineReady('http://127.0.0.1:4000')
  engine([])
  getDb().delete(torrents).run()
  getDb().delete(storageMoves).run()
  getDb().delete(libraries).run()
  getDb().delete(serverSettings).run()
})

afterEach(async () => {
  await moveIdle()
  vi.restoreAllMocks()
  vi.mocked(lstat).mockReset()
  vi.mocked(rename).mockReset()
  vi.mocked(unlink).mockReset()
  vi.mocked(statfs).mockReset()
  vi.mocked(stat).mockReset()
  volumeDeps.volumeKey = volumeKey
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  setEngineDown('stopped')
  installLogger(pino({ level: 'silent' }))
  await rm(root, { recursive: true, force: true })
})

describe('пути хранения', () => {
  it('без выбора в панели действуют пути окружения', async () => {
    const body = await overview()

    expect(body.folders.downloads).toMatchObject({
      path: join(root, 'torrents'),
      source: 'env',
      envPath: join(root, 'torrents'),
      items: 0,
      leftovers: [],
    })
    expect(body.folders.library).toMatchObject({
      path: join(root, 'library'),
      source: 'env',
    })
    expect(body.move).toBeNull()
  })

  it('проверка папки: запись, том, хардлинки и запрещённые места', async () => {
    const check = async (kind: string, path: string) =>
      (
        await app.inject({
          method: 'POST',
          url: '/api/storage/check',
          cookies: owner,
          payload: { kind, path },
        })
      ).json()

    expect(
      await check('downloads', join(root, 'big', 'torrents')),
    ).toMatchObject({
      problem: null,
      exists: false,
      writable: true,
      sameVolume: true,
      linkMode: 'hardlink',
      moveBytes: 0,
    })
    expect((await check('downloads', 'relative')).problem).toBe('not_absolute')
    expect((await check('downloads', join(root, 'library', 'x'))).problem).toBe(
      'overlaps_other',
    )
    expect((await check('library', join(root, 'torrents'))).problem).toBe(
      'overlaps_other',
    )
  })

  it('«Только новые»: новая закачка идёт в новую папку, старые раздачи на месте', async () => {
    const old = insertTorrent({ inEngine: true, selectedFiles: [0] })
    const target = join(root, 'big')

    engine([{ ...liveState }], {
      'POST /torrents': () => json(movieDetails),
    })

    const res = await putPath({
      kind: 'downloads',
      path: target,
      mode: 'new_only',
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().folders.downloads).toMatchObject({
      path: target,
      source: 'panel',
      leftovers: [{ path: join(root, 'torrents'), items: 1 }],
    })
    expect(torrentRow(old.id).downloadDir).toBeNull()

    getDb().delete(torrents).run()
    const fresh = insertTorrent()

    await app.inject({
      method: 'POST',
      url: `/api/torrents/${fresh.id}/download`,
      cookies: owner,
      payload: { files: [0] },
    })

    expect(torrentRow(fresh.id).downloadDir).toBe(target)
    expect(engineCalls()).toContain(`POST /torrents?files=0&dir=${target}`)

    // «Вернуть по умолчанию» — снова окружение
    const reset = await putPath({
      kind: 'downloads',
      path: null,
      mode: 'new_only',
    })

    expect(reset.json().folders.downloads).toMatchObject({
      path: join(root, 'torrents'),
      source: 'env',
    })
  })

  it('move preview includes previous downloads and excludes torrents already at the target', async () => {
    const oldDir = join(root, 'torrents')
    const current = join(root, 'current')
    const target = join(root, 'target')
    await mkdir(oldDir, { recursive: true })
    await mkdir(current, { recursive: true })
    setStoragePath('downloads', current)
    insertTorrent({ inEngine: true })
    insertTorrent({
      infoHash: 'b'.repeat(40),
      inEngine: true,
      downloadDir: current,
    })
    insertTorrent({ infoHash: 'c'.repeat(40), inEngine: false })
    engine([
      { ...liveState, bytesCompleted: 3709107 },
      { ...liveState, infoHash: 'b'.repeat(40), bytesCompleted: 4087412 },
    ])
    const check = async (path: string) =>
      (
        await app.inject({
          method: 'POST',
          url: '/api/storage/check',
          cookies: owner,
          payload: { kind: 'downloads', path },
        })
      ).json()

    expect((await overview()).folders.downloads.bytes).toBe(4087412)
    expect(await check(target)).toMatchObject({
      moveTotalBytes: 7796519,
      moveItems: 2,
      moveBytes: 0,
    })
    expect(await check(oldDir)).toMatchObject({
      moveTotalBytes: 4087412,
      moveItems: 1,
      moveBytes: 0,
    })
    // Current and target share a volume, but the previous folder does not.
    volumeDeps.volumeKey = async path =>
      path === oldDir ? 'old' : 'current'
    expect(await check(target)).toMatchObject({
      sameVolume: false,
      moveTotalBytes: 7796519,
      moveItems: 2,
      moveBytes: 3709107,
    })
    // An empty current folder still has data available to move from leftovers.
    setStoragePath('downloads', join(root, 'empty'))
    expect((await overview()).folders.downloads.items).toBe(0)
    expect(await check(target)).toMatchObject({
      moveTotalBytes: 7796519,
      moveItems: 2,
    })
  })

  it('move preview includes previous managed library folders', async () => {
    const old = managedFolder()
    getDb()
      .insert(mediaFiles)
      .values({
        folderId: old.id,
        relPath: 'old.mkv',
        size: 100,
        mtime: new Date(),
      })
      .run()
    const current = join(root, 'current-library')
    expect(
      (await putPath({ kind: 'library', path: current, mode: 'new_only' }))
        .statusCode,
    ).toBe(200)
    getDb()
      .insert(mediaFiles)
      .values({
        folderId: managedFolder().id,
        relPath: 'new.mkv',
        size: 200,
        mtime: new Date(),
      })
      .run()
    const check = async (path: string) =>
      (
        await app.inject({
          method: 'POST',
          url: '/api/storage/check',
          cookies: owner,
          payload: { kind: 'library', path },
        })
      ).json()
    expect(await check(join(root, 'target-library'))).toMatchObject({
      moveTotalBytes: 300,
      moveItems: 2,
      moveBytes: 0,
    })
    expect(await check(old.path)).toMatchObject({
      moveTotalBytes: 200,
      moveItems: 1,
      moveBytes: 0,
    })
  })

  it('probes actual link capability across same-device mount boundaries', async () => {
    const downloads = join(root, 'torrents')
    await mkdir(downloads, { recursive: true })
    insertTorrent({ inEngine: true })
    engine([{ ...liveState, bytesCompleted: 100 }])
    vi.spyOn(linkDeps, 'link').mockRejectedValue(
      Object.assign(new Error('mount boundary'), { code: 'EXDEV' }),
    )
    // Reflink works, but Go Downloads does not use it.
    vi.spyOn(linkDeps, 'copyFile').mockImplementation((from, to) =>
      copyFile(from, to),
    )
    const check = (kind: string, path: string) =>
      app.inject({
        method: 'POST',
        url: '/api/storage/check',
        cookies: owner,
        payload: { kind, path },
      })
    expect(
      (await check('downloads', join(root, 'downloads-target'))).json(),
    ).toMatchObject({ sameVolume: false, moveBytes: 100 })

    const folder = managedFolder()
    await mkdir(folder.path, { recursive: true })
    await writeFile(join(folder.path, 'video.mkv'), Buffer.alloc(10))
    getDb()
      .insert(mediaFiles)
      .values({
        folderId: folder.id,
        relPath: 'video.mkv',
        size: 10,
        mtime: new Date(),
      })
      .run()
    const libraryTarget = join(root, 'library-target')
    expect((await check('library', libraryTarget)).json()).toMatchObject({
      sameVolume: true,
      moveBytes: 0,
    })
    vi.mocked(linkDeps.copyFile).mockRejectedValue(
      Object.assign(new Error('no reflink'), { code: 'ENOTSUP' }),
    )
    expect((await check('library', libraryTarget)).json()).toMatchObject({
      sameVolume: false,
      moveBytes: 10,
    })
    expect(await readFile(join(folder.path, 'video.mkv'))).toHaveLength(10)
  })

  it('engine-down downloads are unavailable and resumed moves recheck space before copy', async () => {
    insertTorrent({ inEngine: true })
    setEngineDown('starting')
    const target = join(root, 'small-downloads')
    const check = await app.inject({
      method: 'POST',
      url: '/api/storage/check',
      cookies: owner,
      payload: { kind: 'downloads', path: target },
    })
    expect(check.statusCode).toBe(200)
    expect(check.json()).toMatchObject({
      path: target,
      problem: null,
      writable: true,
      moveAvailable: false,
      moveItems: 1,
      sameVolume: false,
    })
    const change = await putPath({
      kind: 'downloads',
      path: target,
      mode: 'move',
    })
    expect(change.statusCode).toBe(503)
    expect(getDb().select().from(storageMoves).all()).toHaveLength(0)
    expect(
      (await putPath({ kind: 'downloads', path: target, mode: 'new_only' }))
        .statusCode,
    ).toBe(200)
    expect((await overview()).folders.downloads.path).toBe(target)

    await mkdir(target, { recursive: true })
    setStoragePath('downloads', target)
    getDb()
      .insert(storageMoves)
      .values({
        kind: 'downloads',
        target,
        status: 'running',
        itemsTotal: 1,
        bytesTotal: 0,
      })
      .run()
    vi.useFakeTimers()
    resumeMoves()
    volumeDeps.volumeKey = async path => path
    engine([{ ...liveState, bytesCompleted: 1024 ** 5 * 100 }])
    setEngineReady('http://127.0.0.1:4000')
    await vi.advanceTimersByTimeAsync(2000)
    await moveIdle()
    vi.useRealTimers()
    expect(getDb().select().from(storageMoves).get()).toMatchObject({
      status: 'failed',
      error: 'no_space',
    })
    expect(engineCalls()).toEqual([])
    expect(
      torrentRow(getDb().select().from(torrents).get()!.id).downloadDir,
    ).toBeNull()
  })

  it('does not write or probe links for a rejected data or external-library path', async () => {
    await mkdir(join(root, 'torrents'), { recursive: true })
    await mkdir(join(root, 'library'), { recursive: true })
    const external = join(root, 'external-library')
    await mkdir(external)
    const library = getDb()
      .insert(libraries)
      .values({ kind: 'video', name: 'External', managed: false })
      .returning()
      .get()
    getDb()
      .insert(libraryFolders)
      .values({ libraryId: library.id, path: external })
      .run()
    const links = vi.spyOn(linkDeps, 'link')
    const copies = vi.spyOn(linkDeps, 'copyFile')
    vi.mocked(writeFile).mockClear()
    for (const [path, problem] of [
      [resolve(config.dataDir), 'inside_data'],
      [external, 'library_folder'],
    ] as const) {
      const check = await app.inject({
        method: 'POST',
        url: '/api/storage/check',
        cookies: owner,
        payload: { kind: 'downloads', path },
      })
      expect(check.json()).toMatchObject({
        problem,
        writable: false,
        linkMode: null,
      })
    }
    expect(links).not.toHaveBeenCalled()
    expect(copies).not.toHaveBeenCalled()
    expect(
      vi
        .mocked(writeFile)
        .mock.calls.filter(([path]) => String(path).includes('.torsher-')),
    ).toEqual([])
  })

  it('папку подключённой библиотеки и каталог данных выбрать нельзя', async () => {
    const res = await putPath({
      kind: 'downloads',
      path: 'relative',
      mode: 'new_only',
    })

    expect(res.statusCode).toBe(422)
    expect(res.json().kind).toBe('not_absolute')
  })

  it.each(['env', 'panel'])(
    'counts isolated torrents in the current %s root without a redundant move',
    async (source) => {
      const current = join(root, source === 'env' ? 'torrents' : 'current')
      if (source === 'panel')
        setStoragePath('downloads', current)
      await mkdir(current, { recursive: true })
      const rows = [
        insertTorrent({ inEngine: true, downloadDir: current }),
        insertTorrent({
          infoHash: 'b'.repeat(40),
          inEngine: true,
          downloadDir: join(current, 'torsher', 'b'.repeat(40)),
        }),
        insertTorrent({
          infoHash: 'c'.repeat(40),
          inEngine: true,
          downloadDir: join(current, 'torsher', 'c'.repeat(40)),
        }),
      ]
      engine(
        rows.map((row, index) => ({
          ...liveState,
          infoHash: row.infoHash,
          bytesCompleted: [10, 20, 0][index],
        })),
      )
      expect((await overview()).folders.downloads).toMatchObject({
        path: current,
        source,
        items: 3,
        bytes: 30,
        leftovers: [],
      })
      const check = await app.inject({
        method: 'POST',
        url: '/api/storage/check',
        cookies: owner,
        payload: { kind: 'downloads', path: current },
      })
      expect(check.statusCode).toBe(200)
      expect(check.json()).toMatchObject({ moveItems: 0, moveTotalBytes: 0 })
      const move = await app.inject({
        method: 'POST',
        url: '/api/storage/move',
        cookies: owner,
        payload: { kind: 'downloads' },
      })
      expect(move.statusCode).toBe(200)
      await moveIdle()
      expect(engineCalls()).toEqual([])
      expect(rows.map(row => torrentRow(row.id).downloadDir)).toEqual(
        rows.map(row => row.downloadDir),
      )

      const previous = [
        join(root, 'old', 'torsher', 'd'.repeat(40)),
        join(current, 'custom'),
        join(current, 'torsher', '0'.repeat(40)),
      ]
      for (const [index, downloadDir] of previous.entries()) {
        insertTorrent({
          infoHash: ['d', 'e', 'f'][index]!.repeat(40),
          inEngine: true,
          downloadDir,
        })
      }
      const folder = (await overview()).folders.downloads
      expect(folder.items).toBe(3)
      expect(folder.bytes).toBe(30)
      expect(folder.leftovers).toEqual(
        previous.map(path => ({
          path,
          items: 1,
          bytes: 0,
        })),
      )
      // Changing the target makes the old isolated paths genuine leftovers.
      setStoragePath('downloads', join(root, 'next'))
      const changed = (await overview()).folders.downloads
      expect(changed.items).toBe(0)
      expect(changed.bytes).toBe(0)
      expect(changed.leftovers).toHaveLength(6)
    },
  )
})

describe('durable acceptance', () => {
  it('keeps the previous path and job list when the only engine preflight fails', async () => {
    insertTorrent({ inEngine: true })
    engine([], {
      'GET /torrents': () => {
        throw new TypeError('Engine disconnected')
      },
    })

    const result = await putPath({
      kind: 'downloads',
      path: join(root, 'rejected'),
      mode: 'move',
    })

    expect(result.statusCode).toBe(503)
    expect(storagePath('downloads')).toBe(join(root, 'torrents'))
    expect(getDb().select().from(storageMoves).all()).toEqual([])
  })

  it('rolls back the setting and leaves link cache and listeners unchanged when job insert fails', async () => {
    const db = getDb()
    const priorMode = currentLinkMode()
    const listener = vi.fn()
    const unsubscribe = onStoragePathsChanged(listener)
    db.$client.exec(
      'CREATE TEMP TRIGGER reject_storage_job BEFORE INSERT ON storage_moves BEGIN SELECT RAISE(ABORT, "job insert failed"); END',
    )
    try {
      const result = await putPath({
        kind: 'library',
        path: join(root, 'rollback-setting'),
        mode: 'move',
      })

      expect(result.statusCode).toBe(500)
      expect(storagePath('library')).toBe(join(root, 'library'))
      expect(getDb().select().from(storageMoves).all()).toEqual([])
      expect(currentLinkMode()).toBe(priorMode)
      expect(listener).not.toHaveBeenCalled()
    }
    finally {
      db.$client.exec('DROP TRIGGER reject_storage_job')
      unsubscribe()
    }
  })

  it('returns the accepted prospective overview even if the engine stops answering after commit', async () => {
    const target = join(root, 'accepted-library')
    let readsBeforeCommit = 0
    engine([], {
      'GET /torrents': () => {
        if (storagePath('library') === target)
          throw new TypeError('After commit')
        readsBeforeCommit++
        return json([])
      },
    })
    const notifications: object[] = []
    const unsubscribe = onStoragePathsChanged(() => {
      notifications.push({
        path: storagePath('library'),
        job: getDb().select().from(storageMoves).get()?.target,
      })
    })
    try {
      const result = await putPath({
        kind: 'library',
        path: target,
        mode: 'move',
      })

      expect(result.statusCode).toBe(200)
      expect(result.json()).toMatchObject({
        library: { path: target },
        folders: { library: { path: target, source: 'panel' } },
        move: { target, status: 'running' },
      })
      expect(readsBeforeCommit).toBe(1)
      expect(notifications).toEqual([{ path: target, job: target }])
    }
    finally {
      unsubscribe()
    }
  })
})

describe('перенос загрузок', () => {
  it('conflict retries in a hash directory and finishes without moving it again', async () => {
    const torrent = insertTorrent({ inEngine: true })
    const target = join(root, 'big')
    const isolated = join(target, 'torsher', INFO_HASH)
    const destinations: string[] = []
    engine([{ ...liveState }], {
      [`POST /torrents/${INFO_HASH}/move`]: (_url, init) => {
        const dir = JSON.parse(String(init.body)).dir
        expect(storageMoveState()?.recovery?.current).toMatchObject({
          kind: 'downloads',
          torrentId: torrent.id,
          target: dir,
        })
        destinations.push(dir)
        return dir === target
          ? json(engineError('storage_path_conflict', 'conflict'), 409)
          : json(moveState(isolated))
      },
    })
    expect(
      (await putPath({ kind: 'downloads', path: target, mode: 'move' }))
        .statusCode,
    ).toBe(200)
    await moveIdle()
    expect(destinations).toEqual([target, isolated])
    expect(torrentRow(torrent.id).downloadDir).toBe(isolated)
    expect((await overview()).move).toMatchObject({
      status: 'done',
      itemsDone: 1,
    })
  })

  it('keeps an isolated torrent isolated on the next storage root', async () => {
    const torrent = insertTorrent({
      inEngine: true,
      downloadDir: join(root, 'old', 'torsher', INFO_HASH),
    })
    const target = join(root, 'big')
    const isolated = join(target, 'torsher', INFO_HASH)
    engine([{ ...liveState }], {
      [`POST /torrents/${INFO_HASH}/move`]: (_url, init) => {
        expect(JSON.parse(String(init.body)).dir).toBe(isolated)
        return json(moveState(isolated))
      },
    })
    expect(
      (await putPath({ kind: 'downloads', path: target, mode: 'move' }))
        .statusCode,
    ).toBe(200)
    await moveIdle()
    expect(torrentRow(torrent.id).downloadDir).toBe(isolated)
  })

  it('раздача переезжает в движке и переключается сразу после переноса', async () => {
    const torrent = insertTorrent({ inEngine: true, selectedFiles: [0] })
    const target = join(root, 'big')
    let polls = 0

    engine([{ ...liveState }], {
      [`POST /torrents/${INFO_HASH}/move`]: () =>
        json(moveState(target, 'running'), 202),
      [`GET /torrents/${INFO_HASH}/move`]: () =>
        json(moveState(target, ++polls > 1 ? 'done' : 'running')),
    })

    const res = await putPath({
      kind: 'downloads',
      path: target,
      mode: 'move',
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().move).toMatchObject({
      kind: 'downloads',
      status: 'running',
      itemsTotal: 1,
    })

    await moveIdle()

    expect(torrentRow(torrent.id).downloadDir).toBe(target)
    expect(engineCalls()).toContain(`POST /torrents/${INFO_HASH}/move`)

    const body = await overview()

    expect(body.move).toMatchObject({
      status: 'done',
      itemsDone: 1,
      error: null,
    })
    expect(body.folders.downloads).toMatchObject({ items: 1, leftovers: [] })
  })

  it('перенос, прерванный перезапуском, продолжается', async () => {
    const torrent = insertTorrent({ inEngine: true })
    const target = join(root, 'big')

    getDb()
      .insert(storageMoves)
      .values({ kind: 'downloads', target, status: 'running', itemsTotal: 1 })
      .run()
    engine([{ ...liveState }], {
      [`POST /torrents/${INFO_HASH}/move`]: () => json(moveState(target)),
    })

    resumeMoves()
    await moveIdle()

    expect(torrentRow(torrent.id).downloadDir).toBe(target)
    expect((await overview()).move).toMatchObject({
      status: 'done',
      itemsDone: 1,
    })
  })

  it.each(['space', 'cancel'])(
    'rechecks %s after the inner engine restart wait before any retry POST',
    async (condition) => {
      const torrent = insertTorrent({ inEngine: true })
      const source = join(root, 'torrents', 'source.mkv')
      const target = join(root, 'restarted-downloads')
      await mkdir(join(source, '..'), { recursive: true })
      await writeFile(source, 'original source')
      volumeDeps.volumeKey = async path => path
      let free = 1000
      vi.mocked(statfs).mockImplementation(
        async () =>
          ({ bsize: 1, blocks: 10000, bavail: free }) as Awaited<
            ReturnType<typeof statfs>
          >,
      )
      let posts = 0
      engine([{ ...liveState, bytesCompleted: 100 }], {
        [`POST /torrents/${INFO_HASH}/move`]: () =>
          json(moveState(target, ++posts === 1 ? 'running' : 'done')),
        [`GET /torrents/${INFO_HASH}/move`]: () => {
          free = 50
          setEngineDown('starting')
          return json(engineError('move_not_found', 'engine restarted'), 404)
        },
        'GET /torrents/storage': () =>
          json([
            {
              infoHash: INFO_HASH,
              dir: join(root, 'torrents'),
              state: 'active',
              conflictingHashes: [],
            },
          ]),
      })
      expect(
        (await putPath({ kind: 'downloads', path: target, mode: 'move' }))
          .statusCode,
      ).toBe(200)
      await vi.waitFor(() => expect(storageMoveState()?.waiting).toBe(true), {
        timeout: 3000,
      })
      if (condition === 'cancel')
        cancelMove()
      setEngineReady('http://127.0.0.1:4000')
      await moveIdle()
      expect(posts).toBe(1)
      expect(storageMoveState()).toMatchObject(
        condition === 'space'
          ? { status: 'failed', error: 'no_space' }
          : { status: 'cancelled' },
      )
      expect(torrentRow(torrent.id).downloadDir).toBeNull()
      expect(await readFile(source, 'utf8')).toBe('original source')
    },
    10000,
  )

  it('тот же каталог под другим путём: путь переключает движок', async () => {
    const torrent = insertTorrent({ inEngine: true })
    const target = join(root, 'alias')

    await mkdir(join(root, 'torrents'), { recursive: true })
    await symlink(join(root, 'torrents'), target)
    engine([{ ...liveState }], {
      [`POST /torrents/${INFO_HASH}/move`]: () =>
        json(moveState(target, 'done'), 200),
    })

    await putPath({ kind: 'downloads', path: target, mode: 'move' })
    await moveIdle()

    expect(engineCalls()).toContain(`POST /torrents/${INFO_HASH}/move`)
    expect(torrentRow(torrent.id).downloadDir).toBe(target)
    expect((await overview()).move).toMatchObject({ status: 'done' })
  })

  it('ошибка движка останавливает перенос, раздача остаётся в старой папке', async () => {
    const torrent = insertTorrent({ inEngine: true })
    const target = join(root, 'big')

    engine([{ ...liveState }], {
      [`POST /torrents/${INFO_HASH}/move`]: () =>
        json(moveState(target, 'failed', 'no space left on device')),
    })

    await putPath({ kind: 'downloads', path: target, mode: 'move' })
    await moveIdle()

    expect(torrentRow(torrent.id).downloadDir).toBeNull()
    expect((await overview()).move).toMatchObject({
      status: 'failed',
      error: 'engine',
    })
  })

  it('пока идёт перенос, сменить папку нельзя; отмена — после текущей раздачи', async () => {
    insertTorrent({ inEngine: true })
    const target = join(root, 'big')
    let finish = false

    engine([{ ...liveState }], {
      [`POST /torrents/${INFO_HASH}/move`]: () =>
        json(moveState(target, 'running'), 202),
      [`GET /torrents/${INFO_HASH}/move`]: () =>
        json(moveState(target, finish ? 'done' : 'running')),
    })

    await putPath({ kind: 'downloads', path: target, mode: 'move' })

    const busy = await putPath({
      kind: 'library',
      path: join(root, 'lib2'),
      mode: 'new_only',
    })

    expect(busy.statusCode).toBe(409)
    expect(busy.json().kind).toBe('busy')

    await app.inject({
      method: 'POST',
      url: '/api/storage/move/cancel',
      cookies: owner,
    })
    finish = true
    await moveIdle()

    expect((await overview()).move).toMatchObject({ status: 'cancelled' })
  })

  it.each(['done', 'recovered'])(
    'finalizes an accepted torrent move before cancellation: %s',
    async (result) => {
      volumeDeps.volumeKey = async path => path
      const torrent = insertTorrent({ inEngine: true, retention: 'keep' })
      const folder = managedFolder()
      getDb()
        .insert(mediaFiles)
        .values({
          folderId: folder.id,
          relPath: 'movie.mkv',
          size: 10,
          mtime: new Date(),
          torrentId: torrent.id,
          fileIndex: 0,
          linkMode: 'hardlink',
        })
        .run()
      const target = join(root, 'cancel-after-accept')
      const accepted = Promise.withResolvers<void>()
      let finish = false
      engine([{ ...liveState, bytesCompleted: 10 }], {
        [`POST /torrents/${INFO_HASH}/move`]: () => {
          accepted.resolve()
          return json(moveState(target, 'running'), 202)
        },
        [`GET /torrents/${INFO_HASH}/move`]: () => {
          if (!finish)
            return json(moveState(target, 'running'))
          return result === 'done'
            ? json(moveState(target))
            : json(engineError('move_not_found', 'engine restarted'), 404)
        },
        'GET /torrents/storage': () =>
          json([
            {
              infoHash: INFO_HASH,
              dir: target,
              state: 'active',
              conflictingHashes: [],
            },
          ]),
      })
      await putPath({ kind: 'downloads', path: target, mode: 'move' })
      try {
        await accepted.promise
        const cancelled = await app.inject({
          method: 'POST',
          url: '/api/storage/move/cancel',
          cookies: owner,
        })
        expect(cancelled.statusCode).toBe(200)
      }
      finally {
        finish = true
        await moveIdle()
      }

      expect(
        engineCalls().filter(
          call => call === `POST /torrents/${INFO_HASH}/move`,
        ),
      ).toHaveLength(1)
      expect(torrentRow(torrent.id).downloadDir).toBe(target)
      expect(storageMoveState()).toMatchObject({
        status: 'cancelled',
        itemsDone: 1,
        bytesDone: 10,
      })
      expect(mediaRows()[0]?.linkMode).toBe('copy')
    },
  )

  it.each(['job', 'inventory', 'unknown'] as const)(
    'reconciles a lost move acknowledgement before cancellation: %s',
    async (proof) => {
      volumeDeps.volumeKey = async path => path
      const torrent = insertTorrent({ inEngine: true, retention: 'keep' })
      const folder = managedFolder()
      getDb()
        .insert(mediaFiles)
        .values({
          folderId: folder.id,
          relPath: 'movie.mkv',
          size: 10,
          mtime: new Date(),
          torrentId: torrent.id,
          fileIndex: 0,
          linkMode: 'hardlink',
        })
        .run()
      const target = join(root, 'move-no-ack')
      engine([{ ...liveState, bytesCompleted: 10 }], {
        [`POST /torrents/${INFO_HASH}/move`]: () => {
          cancelMove()
          throw new TypeError('Connection reset after sending the move')
        },
        [`GET /torrents/${INFO_HASH}/move`]: () =>
          proof === 'job'
            ? json(moveState(target))
            : json(engineError('move_not_found', 'engine restarted'), 404),
        'GET /torrents/storage': () =>
          json(
            proof !== 'unknown'
              ? [
                  {
                    infoHash: INFO_HASH,
                    dir: target,
                    state: 'active',
                    conflictingHashes: [],
                  },
                ]
              : [],
          ),
      })
      expect(
        (await putPath({ kind: 'downloads', path: target, mode: 'move' }))
          .statusCode,
      ).toBe(200)
      await moveIdle()

      const calls = engineCalls()
      expect(
        calls.filter(call => call === `POST /torrents/${INFO_HASH}/move`),
      ).toHaveLength(1)
      expect(calls).toContain(`GET /torrents/${INFO_HASH}/move`)
      if (proof !== 'job')
        expect(calls).toContain('GET /torrents/storage')
      expect(torrentRow(torrent.id).downloadDir).toBe(
        proof === 'unknown' ? null : target,
      )
      expect(storageMoveState()).toMatchObject({
        status: 'cancelled',
        itemsDone: proof === 'unknown' ? 0 : 1,
        bytesDone: proof === 'unknown' ? 0 : 10,
      })
      expect(mediaRows()[0]?.linkMode).toBe(
        proof === 'unknown' ? 'hardlink' : 'copy',
      )
    },
  )

  it.each(['cancel', 'not_found'])(
    'handles %s without an accepted move to reconcile',
    async (outcome) => {
      const torrent = insertTorrent({ inEngine: true })
      const target = join(root, 'move-not-accepted')
      const cancelBeforePost = outcome === 'cancel'
      if (cancelBeforePost) {
        const original = vi.mocked(statfs).getMockImplementation()!
        vi.mocked(statfs).mockImplementation((path, options) => {
          if (storageMoveState()?.status === 'running')
            cancelMove()
          return original(path, options)
        })
      }
      const post = `POST /torrents/${INFO_HASH}/move`
      engine([], {
        [post]: () =>
          json(engineError('torrent_not_found', 'torrent not found'), 404),
      })
      expect(
        (await putPath({ kind: 'downloads', path: target, mode: 'move' }))
          .statusCode,
      ).toBe(200)
      await moveIdle()

      expect(engineCalls()).toEqual(cancelBeforePost ? [] : [post])
      expect(torrentRow(torrent.id).downloadDir).toBe(
        cancelBeforePost ? null : target,
      )
      expect(storageMoveState()).toMatchObject({
        status: cancelBeforePost ? 'cancelled' : 'done',
        itemsDone: cancelBeforePost ? 0 : 1,
      })
    },
  )

  it('места на новом томе не хватит — перенос не начинается', async () => {
    // Каждая папка — свой том
    volumeDeps.volumeKey = async path => path
    insertTorrent({ inEngine: true })
    engine([{ ...liveState, bytesCompleted: 1024 ** 5 * 100 }])

    const res = await putPath({
      kind: 'downloads',
      path: join(root, 'big'),
      mode: 'move',
    })

    expect(res.statusCode).toBe(422)
    expect(res.json().kind).toBe('no_space')
    expect((await overview()).folders.downloads.source).toBe('env')
  })

  it('раздача уехала с тома библиотеки: её файлы в библиотеке — копии', async () => {
    // Каждая папка — свой том
    volumeDeps.volumeKey = async path => path
    const torrent = insertTorrent({ inEngine: true, retention: 'keep' })
    const folder = managedFolder()
    const target = join(root, 'big')
    const file = getDb()
      .insert(mediaFiles)
      .values({
        folderId: folder.id,
        relPath: 'movies/Sample/Sample.mkv',
        size: 10,
        mtime: new Date(),
        torrentId: torrent.id,
        fileIndex: 0,
        linkMode: 'hardlink',
      })
      .returning()
      .get()

    engine([{ ...liveState, bytesCompleted: 10 }], {
      [`POST /torrents/${INFO_HASH}/move`]: () => json(moveState(target)),
    })

    await putPath({ kind: 'downloads', path: target, mode: 'move' })
    await moveIdle()

    const row = getDb()
      .select()
      .from(mediaFiles)
      .all()
      .find(item => item.id === file.id)

    expect(row?.linkMode).toBe('copy')
  })
})

describe('download move recovery', () => {
  function interruptedDownload(
    torrent: Torrent,
    target: string,
    cancelRequested = false,
  ) {
    const recovery = {
      ...(cancelRequested && { cancelRequested }),
      current: {
        kind: 'downloads' as const,
        token: 'recorded-download',
        torrentId: torrent.id,
        infoHash: torrent.infoHash,
        source: join(root, 'torrents'),
        target,
        bytes: 10,
      },
    }
    return getDb()
      .insert(storageMoves)
      .values({
        kind: 'downloads',
        target,
        status: 'running',
        itemsTotal: 1,
        bytesTotal: 10,
        recovery,
      })
      .returning()
      .get()
  }

  function libraryHardlink(torrent: Torrent) {
    getDb()
      .insert(mediaFiles)
      .values({
        folderId: managedFolder().id,
        relPath: 'movie.mkv',
        size: 10,
        mtime: new Date(),
        torrentId: torrent.id,
        fileIndex: 0,
        linkMode: 'hardlink',
      })
      .run()
  }

  it('finalizes a completed move once after startup already reconciles its path', async () => {
    volumeDeps.volumeKey = async path => path
    const target = join(root, 'engine-moved-before-node-exit')
    const torrent = insertTorrent({ inEngine: true })
    libraryHardlink(torrent)
    interruptedDownload(torrent, target, true)
    engine([{ ...liveState, bytesCompleted: 10 }], {
      'GET /torrents/storage': () =>
        json([
          {
            infoHash: INFO_HASH,
            dir: target,
            state: 'active',
            conflictingHashes: [],
          },
        ]),
      [`GET /torrents/${INFO_HASH}/move`]: () =>
        json(engineError('move_not_found', 'engine restarted'), 404),
    })
    await reconcileEngineStorage()
    expect(torrentRow(torrent.id).downloadDir).toBe(target)

    resumeMoves()
    await moveIdle()
    resumeMoves()
    await moveIdle()

    expect(engineCalls()).not.toContain(`POST /torrents/${INFO_HASH}/move`)
    expect(storageMoveState()).toMatchObject({
      status: 'cancelled',
      itemsDone: 1,
      bytesDone: 10,
      recovery: { cancelRequested: true },
    })
    expect(storageMoveState()?.recovery?.current).toBeUndefined()
    expect(mediaRows()[0]?.linkMode).toBe('copy')
  })

  it('waits for the expected ownership after Go publishes done before its inventory', async () => {
    const target = join(root, 'inventory-lags-status')
    const torrent = insertTorrent({ inEngine: true })
    interruptedDownload(torrent, target, true)
    let observed = 0
    engine([{ ...liveState, bytesCompleted: 10 }], {
      'GET /torrents/storage': () =>
        json([
          {
            infoHash: INFO_HASH,
            dir: ++observed === 1 ? join(root, 'torrents') : target,
            state: 'active',
            conflictingHashes: [],
          },
        ]),
      [`GET /torrents/${INFO_HASH}/move`]: () => json(moveState(target)),
    })

    resumeMoves()
    await moveIdle()

    expect(observed).toBeGreaterThanOrEqual(2)
    expect(engineCalls()).not.toContain(`POST /torrents/${INFO_HASH}/move`)
    expect(torrentRow(torrent.id).downloadDir).toBe(target)
    expect(storageMoveState()).toMatchObject({
      status: 'cancelled',
      itemsDone: 1,
      bytesDone: 10,
    })
  })

  it('rolls back directory, link mode and accounting if clearing the durable download intent fails', async () => {
    volumeDeps.volumeKey = async path => path
    const target = join(root, 'atomic-download-accounting')
    const torrent = insertTorrent({ inEngine: true })
    libraryHardlink(torrent)
    interruptedDownload(torrent, target)
    engine([{ ...liveState, bytesCompleted: 10 }], {
      'GET /torrents/storage': () =>
        json([
          {
            infoHash: INFO_HASH,
            dir: target,
            state: 'active',
            conflictingHashes: [],
          },
        ]),
      [`GET /torrents/${INFO_HASH}/move`]: () => json(moveState(target)),
    })
    const sqlite = getDb().$client
    sqlite.exec(`CREATE TEMP TRIGGER fail_move_clear BEFORE UPDATE OF recovery ON storage_moves
      WHEN json_type(old.recovery, '$.current') = 'object' AND json_type(new.recovery, '$.current') IS NULL
      BEGIN SELECT RAISE(ABORT, 'fail before clearing recovery'); END`)
    try {
      resumeMoves()
      await moveIdle()
      expect(torrentRow(torrent.id).downloadDir).toBeNull()
      expect(mediaRows()[0]?.linkMode).toBe('hardlink')
      expect(storageMoveState()).toMatchObject({
        status: 'failed',
        itemsDone: 0,
        bytesDone: 0,
      })
      expect(storageMoveState()?.recovery?.current).toMatchObject({
        kind: 'downloads',
        target,
      })
    }
    finally {
      sqlite.exec('DROP TRIGGER fail_move_clear')
    }

    resumeMoves()
    await moveIdle()
    expect(torrentRow(torrent.id).downloadDir).toBe(target)
    expect(mediaRows()[0]?.linkMode).toBe('copy')
    expect(storageMoveState()).toMatchObject({
      status: 'done',
      itemsDone: 1,
      bytesDone: 10,
      recovery: {},
    })
  })

  it.each([false, true])(
    'retries an unstarted durable POST only if still permitted; cancelled=%s',
    async (cancelled) => {
      const target = join(root, 'recorded-before-post')
      const torrent = insertTorrent({ inEngine: true })
      interruptedDownload(torrent, target, cancelled)
      engine([{ ...liveState, bytesCompleted: 10 }], {
        'GET /torrents/storage': () =>
          json([
            {
              infoHash: INFO_HASH,
              dir: join(root, 'torrents'),
              state: 'active',
              conflictingHashes: [],
            },
          ]),
        [`GET /torrents/${INFO_HASH}/move`]: () =>
          json(engineError('move_not_found', 'not started'), 404),
        [`POST /torrents/${INFO_HASH}/move`]: () => json(moveState(target)),
      })
      resumeMoves()
      await moveIdle()

      expect(
        engineCalls().filter(
          call => call === `POST /torrents/${INFO_HASH}/move`,
        ),
      ).toHaveLength(cancelled ? 0 : 1)
      expect(torrentRow(torrent.id).downloadDir).toBe(
        cancelled ? null : target,
      )
      expect(storageMoveState()).toMatchObject({
        status: cancelled ? 'cancelled' : 'done',
        itemsDone: cancelled ? 0 : 1,
      })
    },
  )

  it('holds the exact target in the intent when the engine returns a stale completed path', async () => {
    const target = join(root, 'expected-target')
    const torrent = insertTorrent({ inEngine: true })
    engine([{ ...liveState, bytesCompleted: 10 }], {
      [`POST /torrents/${INFO_HASH}/move`]: () =>
        json(moveState(join(root, 'stale-target'))),
    })

    expect(
      (await putPath({ kind: 'downloads', path: target, mode: 'move' }))
        .statusCode,
    ).toBe(200)
    await moveIdle()

    expect(torrentRow(torrent.id).downloadDir).toBeNull()
    expect(storageMoveState()).toMatchObject({
      status: 'failed',
      itemsDone: 0,
      recovery: { current: { target } },
    })
  })

  it('does not invent completion for a legacy unfinished job with no current intent', async () => {
    const target = join(root, 'already-reconciled-legacy')
    insertTorrent({ inEngine: true, downloadDir: target })
    getDb()
      .insert(storageMoves)
      .values({
        kind: 'downloads',
        target,
        status: 'running',
        itemsTotal: 1,
        bytesTotal: 10,
      })
      .run()

    resumeMoves()
    await moveIdle()

    expect(storageMoveState()).toMatchObject({
      status: 'failed',
      itemsDone: 0,
      bytesDone: 0,
      itemsTotal: 1,
      bytesTotal: 10,
      recovery: null,
    })
  })
})

describe('library capture recovery', () => {
  async function moveFixture() {
    const folder = managedFolder()
    const target = join(root, 'capture-target')
    const source = join(folder.path, 'source.mkv')
    const audio = join(folder.path, 'source.en.mka')
    await mkdir(folder.path, { recursive: true })
    await writeFile(source, 'video A')
    await writeFile(audio, 'audio A')
    const file = getDb()
      .insert(mediaFiles)
      .values({
        folderId: folder.id,
        relPath: 'source.mkv',
        size: 7,
        mtime: new Date(),
      })
      .returning()
      .get()
    return { folder, target, source, audio, file }
  }

  function isCapture(path: unknown) {
    return basename(dirname(String(path))).startsWith('.torsher-move-')
  }

  it.each(['video', 'sidecar'])(
    'restores bytes replaced immediately before the %s capture',
    async (kind) => {
      const { folder, target, source, audio, file } = await moveFixture()
      const replaced = kind === 'video' ? source : audio
      const held = join(root, 'old-bytes')
      const original = vi.mocked(rename).getMockImplementation()!
      vi.mocked(rename).mockImplementation(async (from, to) => {
        if (basename(String(from)) === basename(replaced) && isCapture(to)) {
          await original(from, held)
          await writeFile(from, 'brand new bytes')
        }
        await original(from, to)
      })

      await putPath({ kind: 'library', path: target, mode: 'move' })
      await moveIdle()

      expect(storageMoveState()).toMatchObject({
        status: 'failed',
        itemsDone: 0,
        recovery: {},
      })
      expect(mediaRows().find(item => item.id === file.id)?.folderId).toBe(
        folder.id,
      )
      expect(await readFile(replaced, 'utf8')).toBe('brand new bytes')
      expect(await readFile(held, 'utf8')).toBe(
        kind === 'video' ? 'video A' : 'audio A',
      )
      expect(await readFile(kind === 'video' ? audio : source, 'utf8')).toBe(
        kind === 'video' ? 'audio A' : 'video A',
      )
    },
  )

  it('holds the captured contents when a new public source prevents restoration', async () => {
    const { target, source, folder } = await moveFixture()
    const hold = join(root, 'recreated-preserved')
    const original = vi.mocked(rename).getMockImplementation()!
    let capturedPath = ''
    vi.mocked(rename).mockImplementation(async (from, to) => {
      await original(from, to)
      if (basename(String(from)) === basename(source) && isCapture(to)) {
        capturedPath = String(to)
        await writeFile(from, 'video A') // byte-equal, but a newly created entry
      }
    })

    await putPath({ kind: 'library', path: target, mode: 'move' })
    await moveIdle()

    expect(storageMoveState()?.recovery?.current).toMatchObject({
      phase: 'rollback',
    })
    expect(storageMoveState()).toMatchObject({
      status: 'failed',
      itemsDone: 0,
    })
    expect(await readFile(capturedPath, 'utf8')).toBe('video A')
    expect(await readFile(source, 'utf8')).toBe('video A')
    expect((await stat(source)).ino).not.toBe((await stat(capturedPath)).ino)
    expect(mediaRows()[0]?.folderId).toBe(folder.id)

    await original(source, hold)
    resumeMoves()
    await moveIdle()
    expect(await readFile(source, 'utf8')).toBe('video A')
    expect(await readFile(hold, 'utf8')).toBe('video A')
    expect(storageMoveState()?.recovery?.current).toBeUndefined()
  })

  it.each(['video', 'sidecar'])(
    'restores captured sources if the %s target is replaced before retargeting',
    async (kind) => {
      const { target, source, audio, folder } = await moveFixture()
      const replaced = join(
        target,
        kind === 'video' ? basename(source) : basename(audio),
      )
      const temp = join(root, 'unrelated')
      await writeFile(temp, 'different bytes')
      const original = vi.mocked(rename).getMockImplementation()!
      vi.mocked(rename).mockImplementation(async (from, to) => {
        await original(from, to)
        if (basename(String(from)) === basename(audio) && isCapture(to))
          await original(temp, replaced)
      })

      await putPath({ kind: 'library', path: target, mode: 'move' })
      await moveIdle()

      expect(storageMoveState()).toMatchObject({
        status: 'failed',
        itemsDone: 0,
      })
      expect(await readFile(replaced, 'utf8')).toBe('different bytes')
      expect(await readFile(source, 'utf8')).toBe('video A')
      expect(await readFile(audio, 'utf8')).toBe('audio A')
      expect(mediaRows()[0]?.folderId).toBe(folder.id)
    },
  )

  it.each([
    'before_capture',
    'after_capture',
    'before_retarget',
    'before_discard',
    'after_discard',
  ])('resumes a current item interrupted %s exactly once', async (phase) => {
    const { target, source, audio, folder, file } = await moveFixture()
    const originalRename = vi.mocked(rename).getMockImplementation()!
    const originalUnlink = vi.mocked(unlink).getMockImplementation()!
    let interrupted = false
    vi.mocked(rename).mockImplementation(async (from, to) => {
      const test
        = !interrupted
          && basename(String(from)) === basename(source)
          && isCapture(to)
      if (test && phase === 'before_capture') {
        interrupted = true
        throw new Error('interrupted before capture')
      }
      await originalRename(from, to)
      if (test && phase === 'after_capture') {
        interrupted = true
        throw new Error('interrupted after capture')
      }
    })
    vi.mocked(unlink).mockImplementation(async (path) => {
      const test = !interrupted && isCapture(path)
      if (test && phase === 'before_discard') {
        interrupted = true
        throw new Error('interrupted before discard')
      }
      await originalUnlink(path)
      if (test && phase === 'after_discard') {
        interrupted = true
        throw new Error('interrupted after discard')
      }
    })
    const sqlite = getDb().$client
    if (phase === 'before_retarget') {
      sqlite.exec(`CREATE TEMP TRIGGER fail_media_retarget BEFORE UPDATE OF recovery ON storage_moves
        WHEN json_extract(new.recovery, '$.current.phase') = 'committed'
        BEGIN SELECT RAISE(ABORT, 'fail media commit'); END`)
    }
    try {
      expect(
        (await putPath({ kind: 'library', path: target, mode: 'move' }))
          .statusCode,
      ).toBe(200)
      await moveIdle()
      expect(storageMoveState()).toMatchObject({
        status: 'failed',
        itemsDone: 0,
      })
      expect(storageMoveState()?.recovery?.current).toMatchObject({
        phase: phase.includes('discard') ? 'committed' : 'prepared',
      })
      const fellAfterRetarget = phase.includes('discard')
      expect(
        mediaRows().find(item => item.id === file.id)?.folderId === folder.id,
      ).toBe(!fellAfterRetarget)
    }
    finally {
      if (phase === 'before_retarget')
        sqlite.exec('DROP TRIGGER fail_media_retarget')
    }

    resumeMoves()
    await moveIdle()
    resumeMoves()
    await moveIdle()

    expect(storageMoveState()).toMatchObject({
      status: 'done',
      itemsDone: 1,
      bytesDone: 14,
      recovery: {},
    })
    expect(await readFile(join(target, basename(source)), 'utf8')).toBe(
      'video A',
    )
    expect(await readFile(join(target, basename(audio)), 'utf8')).toBe(
      'audio A',
    )
    expect(mediaRows().find(item => item.id === file.id)?.folderId).toBe(
      managedFolder().id,
    )
    await expect(lstat(source)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('recovers a captured historical orphan without adding item counters', async () => {
    const { target, source, folder, file } = await moveFixture()
    await putPath({ kind: 'library', path: target, mode: 'new_only' })
    await writeFile(join(target, basename(source)), 'video A')
    getDb()
      .update(mediaFiles)
      .set({ folderId: managedFolder().id })
      .where(eq(mediaFiles.id, file.id))
      .run()
    const original = vi.mocked(rename).getMockImplementation()!
    let interrupted = false
    vi.mocked(rename).mockImplementation(async (from, to) => {
      await original(from, to)
      if (
        basename(String(from)) === basename(source)
        && isCapture(to)
        && !interrupted
      ) {
        interrupted = true
        throw new Error('interrupted after orphan capture')
      }
    })

    const result = await app.inject({
      method: 'POST',
      url: '/api/storage/move',
      cookies: owner,
      payload: { kind: 'library' },
    })
    expect(result.statusCode).toBe(200)
    await moveIdle()
    expect(storageMoveState()?.recovery?.current).toMatchObject({
      orphan: true,
      sourceFolderId: folder.id,
    })
    resumeMoves()
    await moveIdle()

    expect(storageMoveState()).toMatchObject({
      status: 'done',
      itemsDone: 0,
      bytesDone: 0,
      recovery: {},
    })
    expect(await readFile(join(target, basename(source)), 'utf8')).toBe(
      'video A',
    )
    await expect(lstat(source)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('перенос библиотеки', () => {
  it.each([
    ['source', 'video'],
    ['target', 'video'],
    ['target', 'sidecar'],
  ] as const)(
    'preserves originals when a %s %s is replaced during placement',
    async (entry, kind) => {
      const folder = managedFolder()
      const target = join(root, 'replaced-library')
      await mkdir(folder.path, { recursive: true })
      const source = join(folder.path, 'source.mkv')
      const audio = join(folder.path, 'source.en.mka')
      const movedVideo = join(target, 'source.mkv')
      const movedAudio = join(target, 'source.en.mka')
      const changed
        = kind === 'sidecar'
          ? movedAudio
          : entry === 'source'
            ? source
            : movedVideo
      await writeFile(source, 'video')
      await writeFile(audio, 'audio')
      const file = getDb()
        .insert(mediaFiles)
        .values({
          folderId: folder.id,
          relPath: 'source.mkv',
          size: 5,
          mtime: new Date(),
        })
        .returning()
        .get()
      vi.spyOn(linkDeps, 'link').mockImplementation(async (from, to) => {
        await link(from, to)
        if (String(from) === audio) {
          const replacement = join(root, 'replacement')
          await writeFile(replacement, 'other')
          await rename(replacement, changed)
        }
      })

      expect(
        (await putPath({ kind: 'library', path: target, mode: 'move' }))
          .statusCode,
      ).toBe(200)
      await moveIdle()

      expect(storageMoveState()).toMatchObject({
        status: 'failed',
        itemsDone: 0,
      })
      expect(mediaRows().find(row => row.id === file.id)?.folderId).toBe(
        folder.id,
      )
      expect(await readFile(changed, 'utf8')).toBe('other')
      expect(await readFile(source, 'utf8')).toBe(
        entry === 'source' ? 'other' : 'video',
      )
      expect(await readFile(audio, 'utf8')).toBe('audio')
    },
  )

  it.each(['move', 'conflict', 'cancel'] as const)(
    'shares sidecars between independent videos through %s and retry',
    async (interruption) => {
      const folder = managedFolder()
      const target = join(root, 'shared-sidecar-library')
      await mkdir(folder.path, { recursive: true })
      const members = ['same.mkv', 'same.mp4', 'same.srt'] as const
      for (const name of members)
        await writeFile(join(folder.path, name), name)
      const ids = getDb()
        .insert(mediaFiles)
        .values(
          members.slice(0, 2).map(relPath => ({
            folderId: folder.id,
            relPath,
            size: relPath.length,
            mtime: new Date(),
          })),
        )
        .returning()
        .all()
        .map(item => item.id)
      const secondName = members[1]
      if (interruption === 'conflict') {
        await mkdir(target)
        await writeFile(join(target, secondName), 'wrongone')
      }
      if (interruption === 'cancel') {
        vi.spyOn(linkDeps, 'link').mockImplementation(async (from, to) => {
          await link(from, to)
          if (String(from) === join(folder.path, 'same.srt'))
            cancelMove()
        })
      }
      expect(
        (await putPath({ kind: 'library', path: target, mode: 'move' }))
          .statusCode,
      ).toBe(200)
      await moveIdle()
      if (interruption !== 'move') {
        expect(storageMoveState()).toMatchObject({
          status: interruption === 'cancel' ? 'cancelled' : 'failed',
          bytesTotal: 24,
          bytesDone: 8,
          itemsDone: 1,
        })
        expect(await readFile(join(folder.path, secondName), 'utf8')).toBe(
          secondName,
        )
        expect(await readFile(join(folder.path, 'same.srt'), 'utf8')).toBe(
          'same.srt',
        )
        if (interruption === 'conflict')
          await rm(join(target, secondName))
        expect(
          (
            await app.inject({
              method: 'POST',
              url: '/api/storage/move',
              cookies: owner,
              payload: { kind: 'library' },
            })
          ).statusCode,
        ).toBe(200)
        await moveIdle()
      }
      const bytes = interruption === 'move' ? 24 : 16
      expect(storageMoveState()).toMatchObject({
        status: 'done',
        bytesTotal: bytes,
        bytesDone: bytes,
        itemsDone: interruption === 'move' ? 2 : 1,
      })
      expect(
        mediaRows()
          .map(row => row.id)
          .sort(),
      ).toEqual(ids.sort())
      expect(
        mediaRows().every(row => row.folderId === managedFolder().id),
      ).toBe(true)
      for (const name of members) {
        expect(await readFile(join(target, name), 'utf8')).toBe(name)
        await expect(stat(join(folder.path, name))).rejects.toMatchObject({
          code: 'ENOENT',
        })
      }
    },
  )

  it.each(['video_symlink', 'sidecar_symlink', 'parent_alias', 'hardlinks'])(
    'requires an independent regular target entry before source cleanup: %s',
    async (kind) => {
      const folder = managedFolder()
      const sourceDir = join(folder.path, 'nested')
      const target = join(root, 'independent-library')
      await mkdir(sourceDir, { recursive: true })
      await mkdir(target)
      const source = join(sourceDir, 'source.mkv')
      const sidecar = join(sourceDir, 'source.en.mka')
      const moved = join(target, 'nested', 'source.mkv')
      const movedSidecar = join(target, 'nested', 'source.en.mka')
      await writeFile(source, 'video')
      await writeFile(sidecar, 'external audio')
      if (kind === 'parent_alias') {
        await symlink(sourceDir, join(target, 'nested'))
      }
      else {
        await mkdir(join(target, 'nested'))
        if (kind === 'video_symlink') {
          await symlink(source, moved)
        }
        else if (kind === 'sidecar_symlink') {
          await symlink(sidecar, movedSidecar)
        }
        else {
          await link(source, moved)
          await link(sidecar, movedSidecar)
        }
      }
      getDb()
        .insert(mediaFiles)
        .values({
          folderId: folder.id,
          relPath: 'nested/source.mkv',
          size: 5,
          mtime: new Date(),
        })
        .run()
      await putPath({ kind: 'library', path: target, mode: 'move' })
      await moveIdle()
      if (kind === 'hardlinks') {
        expect(storageMoveState()?.status).toBe('done')
        await expect(stat(source)).rejects.toMatchObject({ code: 'ENOENT' })
        await expect(stat(sidecar)).rejects.toMatchObject({ code: 'ENOENT' })
        expect(await readFile(moved, 'utf8')).toBe('video')
        expect(await readFile(movedSidecar, 'utf8')).toBe('external audio')
      }
      else {
        expect(storageMoveState()?.status).toBe('failed')
        expect(await readFile(source, 'utf8')).toBe('video')
        expect(await readFile(sidecar, 'utf8')).toBe('external audio')
        expect(
          await readFile(
            kind === 'sidecar_symlink' ? movedSidecar : moved,
            'utf8',
          ),
        ).toBe(kind === 'sidecar_symlink' ? 'external audio' : 'video')
        expect(mediaRows()[0]?.folderId).toBe(folder.id)
      }
    },
  )

  it.each(['EIO', 'ESTALE', 'EACCES'])(
    'preserves video and sidecars after transient %s at placement',
    async (code) => {
      const folder = managedFolder()
      await mkdir(folder.path, { recursive: true })
      const source = join(folder.path, 'source.mkv')
      const sidecar = join(folder.path, 'source.en.mka')
      const target = join(root, 'sidecar-error-target')
      await writeFile(source, 'video')
      await writeFile(sidecar, 'external audio')
      getDb()
        .insert(mediaFiles)
        .values({
          folderId: folder.id,
          relPath: 'source.mkv',
          size: 5,
          mtime: new Date(),
        })
        .run()
      let placed = false
      vi.spyOn(linkDeps, 'link').mockImplementation(async (from, to) => {
        await link(from, to)
        if (
          String(from) === source
          && String(to) === join(target, 'source.mkv')
        ) {
          placed = true
        }
      })
      const originalStat = vi.mocked(lstat).getMockImplementation()!
      let injected = false
      vi.mocked(lstat).mockImplementation((path, options) => {
        if (placed && !injected && String(path) === sidecar) {
          injected = true
          return Promise.reject(
            Object.assign(new Error('transient sidecar error'), { code }),
          )
        }
        return originalStat(path, options)
      })
      expect(
        (await putPath({ kind: 'library', path: target, mode: 'move' }))
          .statusCode,
      ).toBe(200)
      await moveIdle()
      expect(injected).toBe(true)
      expect(await readFile(sidecar, 'utf8')).toBe('external audio')
      expect(await readFile(source, 'utf8')).toBe('video')
      expect(storageMoveState()?.status).toBe('failed')
      expect(mediaRows()[0]?.folderId).toBe(folder.id)
    },
  )

  it('keeps a sidecar created after the copied sidecar inventory', async () => {
    const folder = managedFolder()
    await mkdir(folder.path, { recursive: true })
    const source = join(folder.path, 'source.mkv')
    const sidecar = join(folder.path, 'source.en.mka')
    const late = join(folder.path, 'source.late.mka')
    const target = join(root, 'sidecar-late-target')
    await writeFile(source, 'video')
    await writeFile(sidecar, 'external audio')
    getDb()
      .insert(mediaFiles)
      .values({
        folderId: folder.id,
        relPath: 'source.mkv',
        size: 5,
        mtime: new Date(),
      })
      .run()
    vi.spyOn(linkDeps, 'link').mockImplementation(async (from, to) => {
      await link(from, to)
      if (String(from) === sidecar)
        await writeFile(late, 'appeared after inventory')
    })
    await putPath({ kind: 'library', path: target, mode: 'move' })
    await moveIdle()
    expect(storageMoveState()?.status).toBe('done')
    expect(await readFile(late, 'utf8')).toBe('appeared after inventory')
    await expect(stat(join(target, 'source.late.mka'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    expect(await readFile(join(target, 'source.en.mka'), 'utf8')).toBe(
      'external audio',
    )
  })

  it('keeps the original sidecar when an occupied target has unverified bytes', async () => {
    const folder = managedFolder()
    await mkdir(folder.path, { recursive: true })
    const source = join(folder.path, 'source.mkv')
    const sidecar = join(folder.path, 'source.en.mka')
    const target = join(root, 'sidecar-occupied-target')
    await mkdir(target)
    await writeFile(source, 'video')
    await writeFile(sidecar, 'original')
    await writeFile(join(target, 'source.en.mka'), 'occupied')
    getDb()
      .insert(mediaFiles)
      .values({
        folderId: folder.id,
        relPath: 'source.mkv',
        size: 5,
        mtime: new Date(),
      })
      .run()
    await putPath({ kind: 'library', path: target, mode: 'move' })
    await moveIdle()
    expect(storageMoveState()?.status).toBe('failed')
    expect(await readFile(source, 'utf8')).toBe('video')
    expect(await readFile(sidecar, 'utf8')).toBe('original')
    expect(await readFile(join(target, 'source.en.mka'), 'utf8')).toBe(
      'occupied',
    )
  })

  it('counts actual video and shared sidecars once in preview and both preflights', async () => {
    const folder = managedFolder()
    await mkdir(folder.path, { recursive: true })
    for (const [name, size] of [
      ['same.mkv', 4],
      ['same.mp4', 5],
      ['same.ru.srt', 6],
      ['same.en.mka', 7],
    ] as const)
      await writeFile(join(folder.path, name), Buffer.alloc(size, 1))
    for (const relPath of ['same.mkv', 'same.mp4']) {
      getDb()
        .insert(mediaFiles)
        .values({
          folderId: folder.id,
          relPath,
          size: relPath.endsWith('.mkv') ? 4 : 5,
          mtime: new Date(),
        })
        .run()
    }
    volumeDeps.volumeKey = async path => path
    vi.mocked(statfs).mockResolvedValue({
      bsize: 1,
      blocks: 100,
      bavail: 21,
    } as Awaited<ReturnType<typeof statfs>>)
    const target = join(root, 'small-library')
    const check = await app.inject({
      method: 'POST',
      url: '/api/storage/check',
      cookies: owner,
      payload: { kind: 'library', path: target },
    })
    expect(check.json()).toMatchObject({
      moveItems: 2,
      moveTotalBytes: 22,
      moveBytes: 22,
    })
    expect(
      (await putPath({ kind: 'library', path: target, mode: 'move' }))
        .statusCode,
    ).toBe(422)
    expect(managedFolder().path).toBe(folder.path)
    expect(
      (await putPath({ kind: 'library', path: target, mode: 'new_only' }))
        .statusCode,
    ).toBe(200)
    const start = await app.inject({
      method: 'POST',
      url: '/api/storage/move',
      cookies: owner,
      payload: { kind: 'library' },
    })
    expect(start.json()).toMatchObject({ kind: 'no_space' })
    expect(getDb().select().from(storageMoves).all()).toHaveLength(0)
    for (const name of ['same.mkv', 'same.mp4', 'same.ru.srt', 'same.en.mka']) {
      expect(await readFile(join(folder.path, name))).toHaveLength(
        name.endsWith('.mkv')
          ? 4
          : name.endsWith('.mp4')
            ? 5
            : name.endsWith('.srt')
              ? 6
              : 7,
      )
    }
  })

  it('файлы и субтитры переезжают в новую папку, старые удаляются', async () => {
    const folder = managedFolder()
    const relPath = 'movies/Example Movie (2008)/Example Movie (2008).mkv'
    const source = join(folder.path, ...relPath.split('/'))
    const subtitle = source.replace(/\.mkv$/, '.ru.srt')

    await mkdir(join(source, '..'), { recursive: true })
    await writeFile(source, Buffer.alloc(100, 1))
    await writeFile(subtitle, 'subtitle')

    const file = getDb()
      .insert(mediaFiles)
      .values({ folderId: folder.id, relPath, size: 100, mtime: new Date() })
      .returning()
      .get()
    const target = join(root, 'big-library')

    const res = await putPath({ kind: 'library', path: target, mode: 'move' })

    expect(res.statusCode).toBe(200)
    await moveIdle()

    const moved = join(target, ...relPath.split('/'))

    expect((await stat(moved)).size).toBe(100)
    expect(await readFile(moved.replace(/\.mkv$/, '.ru.srt'), 'utf8')).toBe(
      'subtitle',
    )
    await expect(stat(source)).rejects.toThrow()

    const row = getDb()
      .select()
      .from(mediaFiles)
      .all()
      .find(item => item.id === file.id)

    expect(row?.folderId).toBe(managedFolder().id)
    expect(managedFolder().path).toBe(target)
    expect((await overview()).folders.library).toMatchObject({
      path: target,
      items: 1,
      leftovers: [],
    })
  })
})

function movesCount() {
  return getDb().select().from(storageMoves).all().length
}

function mediaRows() {
  return getDb().select().from(mediaFiles).all()
}

/** Движок, у которого перенос идёт, пока тест его не отпустит */
function slowMove(target: string) {
  const control = { finish: false }

  engine([{ ...liveState }], {
    [`POST /torrents/${INFO_HASH}/move`]: () =>
      json(moveState(target, 'running'), 202),
    [`GET /torrents/${INFO_HASH}/move`]: () =>
      json(moveState(target, control.finish ? 'done' : 'running')),
  })

  return control
}

describe('параллельные запросы и пути', () => {
  it('две смены папки с переносом сразу: одна начинается, вторая — busy', async () => {
    insertTorrent({ inEngine: true })
    const target = join(root, 'big')
    const control = slowMove(target)

    const responses = await Promise.all([
      putPath({ kind: 'downloads', path: target, mode: 'move' }),
      putPath({ kind: 'downloads', path: target, mode: 'move' }),
    ])

    expect(responses.map(res => res.statusCode).sort()).toEqual([200, 409])
    expect(responses.find(res => res.statusCode === 409)!.json().kind).toBe(
      'busy',
    )
    expect(movesCount()).toBe(1)

    control.finish = true
  })

  it('два «Перенести сюда» сразу: одно задание', async () => {
    insertTorrent({ inEngine: true, downloadDir: join(root, 'old') })
    const control = slowMove(join(root, 'torrents'))
    const start = () =>
      app.inject({
        method: 'POST',
        url: '/api/storage/move',
        cookies: owner,
        payload: { kind: 'downloads' },
      })

    const responses = await Promise.all([start(), start()])

    expect(responses.map(res => res.statusCode).sort()).toEqual([200, 409])
    expect(movesCount()).toBe(1)

    control.finish = true
  })

  it('симлинк на каталог данных выбрать нельзя', async () => {
    const dataDir = resolve(config.dataDir)
    const link = join(root, 'data-link')

    await mkdir(dataDir, { recursive: true })
    await symlink(dataDir, link)

    const res = await putPath({
      kind: 'downloads',
      path: link,
      mode: 'new_only',
    })

    expect(res.statusCode).toBe(422)
    expect(res.json().kind).toBe('inside_data')
  })

  it('библиотеку нельзя положить в прежний каталог раздачи', async () => {
    const old = join(root, 'old-downloads')

    insertTorrent({ inEngine: true, downloadDir: old })

    const res = await putPath({
      kind: 'library',
      path: join(old, 'library'),
      mode: 'new_only',
    })

    expect(res.statusCode).toBe(422)
    expect(res.json().kind).toBe('overlaps_other')
  })

  it('проверка папки подключённой библиотеки ничего в ней не пишет', async () => {
    const media = join(root, 'media')
    const library = getDb()
      .insert(libraries)
      .values({ kind: 'video', name: 'Films' })
      .returning()
      .get()

    await mkdir(media)
    getDb()
      .insert(libraryFolders)
      .values({ libraryId: library.id, path: media })
      .run()

    const res = await app.inject({
      method: 'POST',
      url: '/api/storage/check',
      cookies: owner,
      payload: { kind: 'library', path: media },
    })

    expect(res.json()).toMatchObject({
      problem: 'library_folder',
      writable: false,
    })
    expect(await readdir(media)).toEqual([])
  })

  it('движок нашёл чужой файл в новой папке: ошибка exists', async () => {
    insertTorrent({ inEngine: true })
    const target = join(root, 'big')

    engine([{ ...liveState }], {
      [`POST /torrents/${INFO_HASH}/move`]: () =>
        json(
          moveState(
            target,
            'failed',
            'file already exists in the new directory',
            'exists',
          ),
        ),
    })

    await putPath({ kind: 'downloads', path: target, mode: 'move' })
    await moveIdle()

    expect((await overview()).move).toMatchObject({
      status: 'failed',
      error: 'exists',
    })
  })
})

describe('перенос библиотеки: особые случаи', () => {
  it.each(['symlink', 'parent_alias'])(
    'keeps orphan source when the recorded target is a %s of the same entry',
    async (kind) => {
      const old = managedFolder()
      const sourceDir = join(old.path, 'nested')
      const source = join(sourceDir, 'source.mkv')
      await mkdir(sourceDir, { recursive: true })
      await writeFile(source, 'orphan video')
      const target = join(root, 'orphan-target')
      await putPath({ kind: 'library', path: target, mode: 'new_only' })
      if (kind === 'parent_alias') {
        await symlink(sourceDir, join(target, 'nested'))
      }
      else {
        await mkdir(join(target, 'nested'))
        await symlink(source, join(target, 'nested', 'source.mkv'))
      }
      const current = managedFolder()
      getDb()
        .insert(mediaFiles)
        .values({
          folderId: current.id,
          relPath: 'nested/source.mkv',
          size: 12,
          mtime: new Date(),
        })
        .run()
      await app.inject({
        method: 'POST',
        url: '/api/storage/move',
        cookies: owner,
        payload: { kind: 'library' },
      })
      await moveIdle()
      expect(await readFile(source, 'utf8')).toBe('orphan video')
      expect(await readFile(join(target, 'nested', 'source.mkv'), 'utf8')).toBe(
        'orphan video',
      )
      expect(storageMoveState()?.status).toBe('failed')
    },
  )

  it('симлинк на папку библиотеки: файл на месте, строка — в новой папке', async () => {
    const folder = managedFolder()
    const relPath = 'movies/Example/Example.mkv'
    const file = join(folder.path, ...relPath.split('/'))
    const alias = join(root, 'alias')

    await mkdir(join(file, '..'), { recursive: true })
    await writeFile(file, Buffer.alloc(100, 1))
    await symlink(folder.path, alias)
    getDb()
      .insert(mediaFiles)
      .values({ folderId: folder.id, relPath, size: 100, mtime: new Date() })
      .run()

    const res = await putPath({ kind: 'library', path: alias, mode: 'move' })

    expect(res.statusCode).toBe(200)
    await moveIdle()

    expect((await readFile(file)).equals(Buffer.alloc(100, 1))).toBe(true)

    const rows = mediaRows()

    expect(rows).toHaveLength(1)
    expect(rows[0]!.folderId).toBe(managedFolder().id)
    expect(managedFolder().path).toBe(alias)
  })

  it.each([400, 1000])(
    'preserves library bytes when a torrent file differs; progress=%i',
    async (completed) => {
      const folder = managedFolder()
      const torrent = insertTorrent({
        inEngine: true,
        retention: 'keep',
        files: [{ path: 'Sample.mkv', size: 1000, padding: false }],
      })
      const partial = join(
        root,
        'torrents',
        'Sample Movie (2008)',
        'Sample.mkv',
      )
      const relPath = 'movies/Sample/Sample.mkv'
      const source = join(folder.path, ...relPath.split('/'))
      const content = Buffer.alloc(1000, 7)

      await mkdir(join(partial, '..'), { recursive: true })
      await writeFile(partial, '')
      await truncate(partial, 1000)
      await mkdir(join(source, '..'), { recursive: true })
      await writeFile(source, content)
      getDb()
        .insert(mediaFiles)
        .values({
          folderId: folder.id,
          relPath,
          size: 1000,
          mtime: new Date(),
          torrentId: torrent.id,
          fileIndex: 0,
          linkMode: 'copy',
        })
        .run()
      volumeDeps.volumeKey = async () => 'same-volume'
      engine([{ ...liveState, fileProgress: [completed] }])

      const target = join(root, 'big-library')

      await putPath({ kind: 'library', path: target, mode: 'move' })
      await moveIdle()

      const moved = join(target, ...relPath.split('/'))

      expect((await readFile(moved)).equals(content)).toBe(true)
      expect((await stat(moved)).ino).not.toBe((await stat(partial)).ino)
      expect(mediaRows()[0]!.linkMode).toBe('copy')
    },
  )

  it('файл, оставленный прерванным переносом, удаляется; файл со своей строкой цел', async () => {
    const old = managedFolder()
    const target = join(root, 'new-library')

    await putPath({ kind: 'library', path: target, mode: 'new_only' })

    const current = managedFolder()
    const write = async (dir: string, relPath: string) => {
      const path = join(dir, ...relPath.split('/'))

      await mkdir(join(path, '..'), { recursive: true })
      await writeFile(path, relPath)

      return path
    }
    const row = (folderId: string, relPath: string) =>
      getDb()
        .insert(mediaFiles)
        .values({ folderId, relPath, size: relPath.length, mtime: new Date() })
        .run()

    const orphan = await write(old.path, 'movies/A/A.mkv')
    const orphanSubtitle = await write(old.path, 'movies/A/A.ru.srt')

    await write(current.path, 'movies/A/A.mkv')
    row(current.id, 'movies/A/A.mkv')

    // Имя занято в новой папке: файл остаётся на месте со своей строкой
    const kept = await write(old.path, 'movies/C/C.mkv')

    row(old.id, 'movies/C/C.mkv')
    await write(current.path, 'movies/C/C.mkv')
    row(current.id, 'movies/C/C.mkv')

    const res = await app.inject({
      method: 'POST',
      url: '/api/storage/move',
      cookies: owner,
      payload: { kind: 'library' },
    })

    expect(res.statusCode).toBe(200)
    await moveIdle()

    await expect(stat(orphan)).rejects.toThrow()
    expect(await readFile(orphanSubtitle, 'utf8')).toBe('movies/A/A.ru.srt')
    expect(await readFile(kept, 'utf8')).toBe('movies/C/C.mkv')
    expect(
      await readFile(join(current.path, 'movies', 'A', 'A.mkv'), 'utf8'),
    ).toBe('movies/A/A.mkv')
    expect(managedFolders().some(folder => folder.id === old.id)).toBe(true)
  })

  it('перенос библиотеки после перезапуска не ждёт движок', async () => {
    const folder = managedFolder()
    const relPath = 'movies/Example/Example.mkv'
    const source = join(folder.path, ...relPath.split('/'))
    const target = join(root, 'big-library')

    await mkdir(join(source, '..'), { recursive: true })
    await writeFile(source, Buffer.alloc(10, 1))
    getDb()
      .insert(mediaFiles)
      .values({ folderId: folder.id, relPath, size: 10, mtime: new Date() })
      .run()
    setStoragePath('library', target)
    getDb()
      .insert(storageMoves)
      .values({ kind: 'library', target, status: 'running', itemsTotal: 1 })
      .run()
    setEngineDown('stopped')

    resumeMoves()
    await moveIdle()

    expect((await overview()).move).toMatchObject({
      status: 'done',
      itemsDone: 1,
    })
    expect((await stat(join(target, ...relPath.split('/')))).size).toBe(10)
  })
})
