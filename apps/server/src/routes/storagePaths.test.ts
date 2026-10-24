import type { Torrent } from '../db/schema.ts'
import { Buffer } from 'node:buffer'
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  truncate,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
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
import { installLogger } from '../services/logs/index.ts'
import { volumeDeps } from '../services/storage/folders.ts'
import { moveIdle, resumeMoves } from '../services/storage/move.ts'
import { setStoragePath } from '../services/storage/paths.ts'
import { signToken } from '../utils/token.ts'

const app = createApp()
const fetchMock = vi.fn<typeof fetch>()
const owner = { [ACCESS_TOKEN_COOKIE]: signToken('owner', 'user_access') }
const volumeKey = volumeDeps.volumeKey
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

  it('недокачанный файл раздачи не становится источником хардлинка', async () => {
    const folder = managedFolder()
    const torrent = insertTorrent({
      inEngine: true,
      retention: 'keep',
      files: [{ path: 'Sample.mkv', size: 1000, padding: false }],
    })
    const partial = join(root, 'torrents', 'Sample Movie (2008)', 'Sample.mkv')
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
    engine([{ ...liveState, fileProgress: [400] }])

    const target = join(root, 'big-library')

    await putPath({ kind: 'library', path: target, mode: 'move' })
    await moveIdle()

    const moved = join(target, ...relPath.split('/'))

    expect((await readFile(moved)).equals(content)).toBe(true)
    expect((await stat(moved)).ino).not.toBe((await stat(partial)).ino)
    expect(mediaRows()[0]!.linkMode).toBe('copy')
  })

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
    await expect(stat(orphanSubtitle)).rejects.toThrow()
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
