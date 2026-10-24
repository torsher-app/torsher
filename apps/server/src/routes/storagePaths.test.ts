import type { Torrent } from '../db/schema.ts'
import { Buffer } from 'node:buffer'
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
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
import { createApp } from '../app.ts'
import { ACCESS_TOKEN_COOKIE } from '../config.ts'
import { getDb, migrateDb } from '../db/index.ts'
import {
  libraries,
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
import { managedFolder } from '../services/library/files.ts'
import { installLogger } from '../services/logs/index.ts'
import { volumeDeps } from '../services/storage/folders.ts'
import { moveIdle, resumeMoves } from '../services/storage/move.ts'
import { signToken } from '../utils/token.ts'

const app = createApp()
const fetchMock = vi.fn<typeof fetch>()
const owner = { [ACCESS_TOKEN_COOKIE]: signToken('owner', 'user_access') }
const sameVolume = volumeDeps.sameVolume
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
      name: 'Owner',
      email: 'owner@example.com',
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
  volumeDeps.sameVolume = sameVolume
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

  it('папку подключённой библиотеки и каталог данных выбрать нельзя', async () => {
    const res = await putPath({
      kind: 'downloads',
      path: 'relative',
      mode: 'new_only',
    })

    expect(res.statusCode).toBe(422)
    expect(res.json().kind).toBe('not_absolute')
  })
})

describe('перенос загрузок', () => {
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

  it('места на новом томе не хватит — перенос не начинается', async () => {
    volumeDeps.sameVolume = async () => false
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
    volumeDeps.sameVolume = async () => false
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

describe('перенос библиотеки', () => {
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
