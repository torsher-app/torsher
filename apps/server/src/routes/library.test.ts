import type { Torrent, TorrentFileEntry } from '../db/schema.ts'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
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
import { createApp } from '../app.ts'
import { ACCESS_TOKEN_COOKIE, DEVICE_TOKEN_COOKIE } from '../config.ts'
import { getDb, migrateDb } from '../db/index.ts'
import {
  devices,
  mediaFiles,
  metaCache,
  profiles,
  torrents,
  users,
} from '../db/schema.ts'
import { setEngineDown, setEngineReady } from '../services/engine/index.ts'
import { engineError } from '../services/engine/fixtures/index.ts'
import { checkLinkMode, syncLibrary } from '../services/library/index.ts'
import { linkDeps } from '../services/library/link.ts'
import { installLogger } from '../services/logs/index.ts'
import { signToken } from '../utils/token.ts'

const GIB = 1024 ** 3
const HASH = 'abcdefabcdefabcdefabcdefabcdefabcdefabcd'
const disk = vi.hoisted(() => ({ total: 0, free: 0 }))

vi.mock('../services/storage/disk.ts', () => ({
  diskUsage: async () => ({ ...disk }),
}))

const app = createApp()
const fetchMock = vi.fn<typeof fetch>()
const owner = { [ACCESS_TOKEN_COOKIE]: signToken('owner', 'user_access') }
let root = ''
let progress: number[] = []
let selected: number[] = []

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// Синтетические тайтлы: ID и названия вымышленные
const identities: Record<string, object> = {
  // Те же поля отдают и детали для карточки ряда
  '/3/movie/603': {
    id: 603,
    poster_path: '/example.jpg',
    genres: [],
    title: 'Example Movie',
    original_title: 'Example Movie',
    original_language: 'en',
    release_date: '2008-05-01',
    translations: {
      translations: [{ iso_639_1: 'ru', data: { title: 'Пример фильма' } }],
    },
  },
  '/3/tv/1396': {
    name: 'Example Show',
    original_name: 'Example Show',
    original_language: 'en',
    first_air_date: '2008-01-20',
    seasons: [
      { season_number: 0, episode_count: 3 },
      { season_number: 1, episode_count: 7 },
      { season_number: 2, episode_count: 13 },
    ],
  },
}

const movieFiles = [
  { path: 'Example.Movie.2008.1080p.mkv', size: 4000 },
  { path: 'Example.Movie.2008.Rus.srt', size: 10 },
  { path: 'Example.Movie.2008.sample.mkv', size: 20 },
]

// Поиск TMDB по названию раздачи: запрос в нижнем регистре
let searchResults: Record<string, object[]> = {}

const engineCalls: string[] = []

beforeAll(async () => {
  await migrateDb()
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
  root = await mkdtemp(join(tmpdir(), 'torsher-library-'))
  vi.stubEnv('DOWNLOADS_PATH', join(root, 'torrents'))
  vi.stubEnv('LIBRARY_PATH', join(root, 'library'))
  vi.stubEnv('TMDB_ACCESS_TOKEN', 'test-token')
  disk.total = 1000 * GIB
  disk.free = 500 * GIB
  engineCalls.length = 0
  searchResults = {}
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input, init = {}) => {
    const url = new URL(String(input))
    const call = `${init.method ?? 'GET'} ${url.pathname}`

    if (url.hostname === 'api.themoviedb.org') {
      if (url.pathname === '/3/search/multi') {
        return json({
          results: searchResults[url.searchParams.get('query') ?? ''] ?? [],
        })
      }

      const found = identities[url.pathname]
      return found ? json(found) : json({}, 404)
    }

    if (call === 'GET /torrents') {
      return json([
        {
          infoHash: HASH,
          paused: false,
          selected,
          bytesCompleted: progress.reduce((sum, value) => sum + value, 0),
          bytesWanted: 0,
          wantedCompleted: 0,
          seeding: true,
          peers: { connected: 0, found: 0, seeders: 0 },
          downloadSpeed: 0,
          uploadSpeed: 0,
          fileProgress: progress,
        },
      ])
    }

    if (call === `GET /torrents/${HASH}/stats`) {
      return json({
        infoHash: HASH,
        paused: false,
        selected,
        bytesCompleted: 0,
        bytesWanted: 0,
        wantedCompleted: 0,
        seeding: false,
        peers: { connected: 0, found: 0, seeders: 0 },
        downloadSpeed: 0,
        uploadSpeed: 0,
        fileProgress: progress,
        pieces: '',
      })
    }

    engineCalls.push(`${call}${url.search}`)

    if (call === `PUT /torrents/${HASH}/files`)
      return new Response(null, { status: 204 })

    if (call === 'POST /torrents') {
      return json({
        infoHash: HASH,
        name: 'Example Movie (2008)',
        pieceLength: 16_384,
        pieceCount: 1,
        files: movieFiles.map(file => ({
          path: file.path,
          length: file.size,
          padding: false,
        })),
      })
    }

    if (call === `DELETE /torrents/${HASH}`)
      return json({ deletedBytes: 0 })

    return json(engineError('torrent_not_found', 'not found'), 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  setEngineReady('http://127.0.0.1:4000')
  getDb().delete(mediaFiles).run()
  getDb().delete(torrents).run()
  getDb().delete(metaCache).run()
  await checkLinkMode()
})

afterEach(async () => {
  // Роуты запускают связыватель в фоне: он не должен писать в удаляемый каталог
  await syncLibrary()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  setEngineDown('stopped')
  installLogger(pino({ level: 'silent' }))
  await rm(root, { recursive: true, force: true })
})

/** Раздача в базе и её файлы в загрузках, как их кладёт движок */
async function seed(
  name: string,
  files: Array<{ path: string, size: number }>,
  values: Partial<typeof torrents.$inferInsert> = {},
): Promise<Torrent> {
  for (const file of files) {
    const path = join(root, 'torrents', name, ...file.path.split('/'))

    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, Buffer.alloc(file.size, 1))
  }

  return getDb()
    .insert(torrents)
    .values({
      infoHash: HASH,
      name,
      source: 'file',
      torrentFile: Buffer.from('d4:infoe'),
      files: files.map<TorrentFileEntry>(file => ({
        ...file,
        padding: false,
      })),
      pieceLength: 16_384,
      status: 'ready',
      inEngine: true,
      retention: 'keep',
      ...values,
    })
    .returning()
    .get()
}

function libraryPath(...parts: string[]) {
  return join(root, 'library', ...parts)
}

function rows() {
  return getDb().select().from(mediaFiles).all()
}

function torrentRow(id: string) {
  return getDb()
    .select()
    .from(torrents)
    .all()
    .find(row => row.id === id)
}

const movieFolder = 'Example Movie (2008) [tmdbid-603]'

describe('связыватель', () => {
  it('фильм: скачанный целиком файл — хардлинком, субтитры рядом, раздача остаётся', async () => {
    const torrent = await seed('Example Movie (2008)', movieFiles, {
      titleId: 'tmdb:movie:603',
    })

    progress = [4000, 10, 20]
    selected = [0, 1]
    await syncLibrary()

    const video = libraryPath('movies', movieFolder, `${movieFolder}.mkv`)

    expect((await stat(video)).nlink).toBe(2)
    expect(await readdir(libraryPath('movies', movieFolder))).toEqual([
      `${movieFolder}.mkv`,
      `${movieFolder}.rus.srt`,
    ])
    expect(rows()).toEqual([
      expect.objectContaining({
        torrentId: torrent.id,
        fileIndex: 0,
        linkMode: 'hardlink',
        titleId: 'tmdb:movie:603',
        season: 0,
        episode: 0,
        matchStatus: 'matched',
        matchSource: 'torrent',
        size: 4000,
      }),
    ])
    expect(torrentRow(torrent.id)?.retention).toBe('keep')

    const response = await app.inject({
      url: `/api/torrents/${torrent.id}`,
      cookies: owner,
    })

    expect(response.json()).toMatchObject({
      inLibrary: true,
      files: [
        { index: 0, inLibrary: true },
        { index: 1, inLibrary: false },
        { index: 2, inLibrary: false },
      ],
    })

    // Повторный проход ничего не дублирует
    await syncLibrary()
    expect(rows()).toHaveLength(1)
  })

  it('недокачанный файл и раздача без тайтла в библиотеку не попадают', async () => {
    await seed('Example Movie (2008)', movieFiles, {
      titleId: 'tmdb:movie:603',
    })

    progress = [3999, 10, 20]
    await syncLibrary()
    expect(rows()).toEqual([])

    getDb().update(torrents).set({ titleId: null }).run()
    progress = [4000, 10, 20]
    await syncLibrary()
    expect(rows()).toEqual([])
    await expect(stat(libraryPath('movies'))).rejects.toThrow()
  })

  it('раздача из кэша не раскладывается', async () => {
    await seed('Example Movie (2008)', movieFiles, {
      titleId: 'tmdb:movie:603',
      retention: 'cache',
    })

    progress = [4000, 10, 20]
    await syncLibrary()
    expect(rows()).toEqual([])
  })

  it('название — на языке первого профиля', async () => {
    const { createProfile } = await import('../services/profiles/index.ts')
    const created = createProfile({
      name: 'Ru',
      color: 'violet',
      language: null,
      ageLimit: null,
    })

    getDb().update(profiles).set({ language: 'ru_RU' }).run()
    await seed('Example Movie (2008)', movieFiles, {
      titleId: 'tmdb:movie:603',
    })
    progress = [4000, 10, 20]
    await syncLibrary()

    expect(rows()[0]?.relPath).toBe(
      'movies/Пример фильма (2008) [tmdbid-603]/Пример фильма (2008) [tmdbid-603].mkv',
    )

    getDb().update(profiles).set({ language: null }).run()
    getDb().delete(profiles).where(eq(profiles.id, created.id)).run()
  })

  it('сериал: серии пака по номерам, недокачанная ждёт своего прохода', async () => {
    const name = 'Example.Show.S01.1080p'

    await seed(
      name,
      [
        { path: 'Example.Show.S01E01.1080p.mkv', size: 3000 },
        { path: 'Example.Show.S01E02.1080p.mkv', size: 3000 },
        { path: 'Subs/Example.Show.S01E01.eng.forced.srt', size: 10 },
      ],
      { titleId: 'tmdb:tv:1396' },
    )

    progress = [3000, 1000, 10]
    await syncLibrary()

    const season = libraryPath(
      'shows',
      'Example Show (2008) [tmdbid-1396]',
      'Season 01',
    )

    expect(await readdir(season)).toEqual([
      'Example Show S01E01.eng.forced.srt',
      'Example Show S01E01.mkv',
    ])

    progress = [3000, 3000, 10]
    await syncLibrary()

    expect(await readdir(season)).toEqual([
      'Example Show S01E01.eng.forced.srt',
      'Example Show S01E01.mkv',
      'Example Show S01E02.mkv',
    ])
    expect(
      rows()
        .map(row => [row.season, row.episode])
        .sort(),
    ).toEqual([
      [1, 1],
      [1, 2],
    ])
  })

  it('вторая раздача того же фильма — вторая версия рядом', async () => {
    await seed('Example Movie (2008)', movieFiles, {
      titleId: 'tmdb:movie:603',
    })
    progress = [4000, 10, 20]
    await syncLibrary()

    getDb().delete(torrents).run()
    await seed(
      'Example.Movie.2008.2160p',
      [{ path: 'Example.Movie.2008.2160p.mkv', size: 5000 }],
      { titleId: 'tmdb:movie:603' },
    )
    progress = [5000]
    await syncLibrary()

    expect(await readdir(libraryPath('movies', movieFolder))).toEqual([
      `${movieFolder} - 2160p.mkv`,
      `${movieFolder}.mkv`,
      `${movieFolder}.rus.srt`,
    ])
  })

  it('без хардлинка и reflink — копия, раздача возвращается в кэш', async () => {
    vi.spyOn(linkDeps, 'link').mockRejectedValue(
      Object.assign(new Error('EXDEV'), { code: 'EXDEV' }),
    )
    vi.spyOn(linkDeps, 'copyFile').mockImplementation(async (a, b, mode) => {
      if (mode === constants.COPYFILE_FICLONE_FORCE)
        throw Object.assign(new Error('ENOTSUP'), { code: 'ENOTSUP' })
      await copyFile(a, b)
    })
    await checkLinkMode()

    const torrent = await seed('Example Movie (2008)', movieFiles, {
      titleId: 'tmdb:movie:603',
      selectedFiles: [0, 1],
    })

    progress = [4000, 10, 20]
    selected = [0, 1]
    await syncLibrary()

    const video = libraryPath('movies', movieFolder, `${movieFolder}.mkv`)

    expect((await stat(video)).nlink).toBe(1)
    expect(rows()[0]?.linkMode).toBe('copy')
    expect(torrentRow(torrent.id)).toMatchObject({
      retention: 'cache',
      selectedFiles: null,
    })
    expect(engineCalls).toContain(`PUT /torrents/${HASH}/files`)

    // Загрузки и библиотека на разных томах — предупреждение на «Обзоре»
    const overview = await app.inject({ url: '/api/overview', cookies: owner })

    expect(overview.json().attention).toContainEqual(
      expect.objectContaining({ kind: 'library_copies', section: 'storage' }),
    )
  })
})

describe('действия с библиотекой', () => {
  async function placedMovie() {
    const torrent = await seed('Example Movie (2008)', movieFiles, {
      titleId: 'tmdb:movie:603',
      selectedFiles: [0, 1],
    })

    progress = [4000, 10, 20]
    selected = [0, 1]
    await syncLibrary()
    return torrent
  }

  it('«Убрать из библиотеки»: файлы и пустые папки удалены, раздача — в кэш', async () => {
    const torrent = await placedMovie()

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/torrents/${torrent.id}/library`,
      cookies: owner,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      retention: 'cache',
      inLibrary: false,
    })
    expect(rows()).toEqual([])
    expect(await readdir(libraryPath())).toEqual([])
    // Раздача в загрузках цела и раздаётся из кэша
    expect(
      (
        await stat(
          join(root, 'torrents', 'Example Movie (2008)', movieFiles[0]!.path),
        )
      ).nlink,
    ).toBe(1)
  })

  it('удаление раздачи с файлами не трогает библиотеку', async () => {
    const torrent = await placedMovie()

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/torrents/${torrent.id}?files=delete`,
      cookies: owner,
    })

    expect(response.statusCode).toBe(200)
    expect(
      await stat(libraryPath('movies', movieFolder, `${movieFolder}.mkv`)),
    ).toBeTruthy()
    expect(rows()).toEqual([expect.objectContaining({ torrentId: null })])
  })

  it('хранилище: объём библиотеки, общие байты не считаются дважды', async () => {
    await placedMovie()

    const response = await app.inject({ url: '/api/storage', cookies: owner })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      // Хардлинк: байты видео общие с раздачей, вытеснение их не освободит
      keptUsed: 30,
      library: {
        used: 4000,
        shared: 4000,
        linkMode: 'hardlink',
      },
    })
  })

  it('«Скачать» добавляет к выбору внешние субтитры выбранного видео', async () => {
    const torrent = await seed('Example Movie (2008)', movieFiles)

    const response = await app.inject({
      method: 'POST',
      url: `/api/torrents/${torrent.id}/download`,
      cookies: owner,
      payload: { files: [0] },
    })

    expect(response.statusCode).toBe(200)
    expect(engineCalls).toContain('POST /torrents?files=0,1')
  })
})

describe('витрина: скачать, оставить, значки', () => {
  const SHOW = 'tmdb:tv:1396'
  const showFiles = [
    { path: 'Example.Show.S01E01.1080p.mkv', size: 3000 },
    { path: 'Example.Show.S01E02.1080p.mkv', size: 3000 },
    { path: 'Example.Show.S01E02.rus.srt', size: 10 },
  ]

  function post(url: string, payload?: object) {
    return app.inject({ method: 'POST', url, cookies: owner, payload })
  }

  it('«Скачать выбранное» дополняет выбор и добавляет субтитры серии', async () => {
    const torrent = await seed('Example.Show.S01.1080p', showFiles, {
      titleId: SHOW,
      selectedFiles: [0],
    })

    progress = [3000, 1000, 0]
    selected = [0]

    const res = await post(`/api/titles/${SHOW}/download`, {
      torrentId: torrent.id,
      files: [1],
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      status: 'started',
      files: 1,
      bytes: 2000,
    })
    expect(engineCalls).toContain('POST /torrents?files=0,1,2')
    expect(torrentRow(torrent.id)).toMatchObject({ retention: 'keep' })
  })

  it('субтитры и чужой индекс не выбираются — 404', async () => {
    const torrent = await seed('Example.Show.S01.1080p', showFiles, {
      titleId: SHOW,
    })

    expect(
      (
        await post(`/api/titles/${SHOW}/download`, {
          torrentId: torrent.id,
          files: [2],
        })
      ).statusCode,
    ).toBe(404)
    expect(
      (
        await post(`/api/titles/tmdb:tv:1/download`, {
          torrentId: torrent.id,
          files: [0],
        })
      ).statusCode,
    ).toBe(404)
  })

  it('места не хватит — 507 с причиной, закачка не начинается', async () => {
    const torrent = await seed('Example.Show.S01.1080p', showFiles, {
      titleId: SHOW,
      retention: 'cache',
    })

    progress = [0, 0, 0]
    // Запас по умолчанию — 20 ГБ из 1000: свободно чуть больше него
    disk.free = 20 * GIB + 100

    const res = await post(`/api/titles/${SHOW}/download`, {
      torrentId: torrent.id,
      files: [0, 1],
    })

    expect(res.statusCode).toBe(507)
    expect(res.json()).toMatchObject({ kind: 'no_space', needed: 6000 })
    expect(engineCalls.some(call => call.startsWith('POST /torrents'))).toBe(
      false,
    )
    expect(torrentRow(torrent.id)?.retention).toBe('cache')
  })

  it('состояние тайтла: качается, в библиотеке, можно оставить', async () => {
    await seed('Example.Show.S01.1080p', showFiles, {
      titleId: SHOW,
      selectedFiles: [0, 1],
    })

    const state = async () =>
      (
        await app.inject({
          url: `/api/titles/${SHOW}/download`,
          cookies: owner,
        })
      ).json()

    progress = [3000, 1000, 0]
    selected = [0, 1]
    fetchMock.mockImplementationOnce(async () =>
      json([
        {
          infoHash: HASH,
          paused: false,
          selected,
          bytesCompleted: 4000,
          bytesWanted: 6000,
          wantedCompleted: 4000,
          seeding: true,
          peers: { connected: 0, found: 0, seeders: 0 },
          downloadSpeed: 0,
          uploadSpeed: 0,
          fileProgress: progress,
        },
      ]),
    )
    expect(await state()).toMatchObject({
      state: 'downloading',
      progress: 4000 / 6000,
      canKeep: false,
      stalled: true,
    })

    progress = [3000, 3000, 0]
    await syncLibrary()
    expect(await state()).toMatchObject({ state: 'library' })

    // На постере — тот же значок по последнему снимку движка
    const { withPosterRatings }
      = await import('../services/mine/posterRatings.ts')
    const { defaultProfile } = await import('../services/profiles/index.ts')
    const [card] = withPosterRatings(
      [
        {
          id: SHOW,
          kind: 'series',
          title: 'Example Show',
          originalTitle: 'Example Show',
        },
      ],
      defaultProfile().id,
    )

    expect(card).toMatchObject({ availability: 'library' })
    expect(card).not.toHaveProperty('downloadProgress', expect.anything())
  })

  it('«Оставить»: раздача из кэша закрепляется и докачивает начатое', async () => {
    const torrent = await seed('Example.Show.S01.1080p', showFiles, {
      titleId: SHOW,
      retention: 'cache',
    })

    progress = [3000, 500, 0]
    selected = []

    const status = await app.inject({
      url: `/api/titles/${SHOW}/download`,
      cookies: owner,
    })

    expect(status.json()).toMatchObject({ canKeep: true })

    const res = await post(`/api/titles/${SHOW}/keep`)

    expect(res.statusCode).toBe(200)
    expect(torrentRow(torrent.id)).toMatchObject({
      retention: 'keep',
      selectedFiles: [0, 1, 2],
    })
    expect(engineCalls).toContain(`PUT /torrents/${HASH}/files`)
  })

  it('«Оставить» без просмотренного — 409', async () => {
    expect((await post(`/api/titles/${SHOW}/keep`)).statusCode).toBe(409)
  })
})

describe('витрина: отмена загрузки', () => {
  const SHOW = 'tmdb:tv:1396'

  it('раздача возвращается в кэш, файлы библиотеки остаются; без закачки — 409', async () => {
    const torrent = await seed(
      'Example.Show.S01.1080p',
      [
        { path: 'Example.Show.S01E01.1080p.mkv', size: 3000 },
        { path: 'Example.Show.S01E02.1080p.mkv', size: 3000 },
      ],
      { titleId: SHOW, selectedFiles: [0, 1] },
    )

    progress = [3000, 1000]
    selected = [0, 1]
    await syncLibrary()
    fetchMock.mockImplementationOnce(async () =>
      json([
        {
          infoHash: HASH,
          paused: false,
          selected,
          bytesCompleted: 4000,
          bytesWanted: 6000,
          wantedCompleted: 4000,
          seeding: true,
          peers: { connected: 2, found: 5, seeders: 1 },
          downloadSpeed: 100,
          uploadSpeed: 0,
          fileProgress: progress,
        },
      ]),
    )

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/titles/${SHOW}/download`,
      cookies: owner,
    })

    expect(res.statusCode).toBe(200)
    expect(torrentRow(torrent.id)).toMatchObject({
      retention: 'cache',
      selectedFiles: null,
    })
    expect(rows()).toHaveLength(1)

    const again = await app.inject({
      method: 'DELETE',
      url: `/api/titles/${SHOW}/download`,
      cookies: owner,
    })

    expect(again.statusCode).toBe(409)
  })

  it('отмена одной раздачи: чужой id — 409, закачка остаётся', async () => {
    const torrent = await seed(
      'Example.Show.S01.1080p',
      [{ path: 'Example.Show.S01E01.1080p.mkv', size: 3000 }],
      { titleId: SHOW, selectedFiles: [0] },
    )

    progress = [1000]
    selected = [0]

    const live = () =>
      fetchMock.mockImplementationOnce(async () =>
        json([
          {
            infoHash: HASH,
            paused: false,
            selected,
            bytesCompleted: 1000,
            bytesWanted: 3000,
            wantedCompleted: 1000,
            seeding: true,
            peers: { connected: 1, found: 1, seeders: 1 },
            downloadSpeed: 10,
            uploadSpeed: 0,
            fileProgress: progress,
          },
        ]),
      )

    live()
    const other = await app.inject({
      method: 'DELETE',
      url: `/api/titles/${SHOW}/download?torrentId=missing`,
      cookies: owner,
    })

    expect(other.statusCode).toBe(409)
    expect(torrentRow(torrent.id)).toMatchObject({ retention: 'keep' })

    live()
    const own = await app.inject({
      method: 'DELETE',
      url: `/api/titles/${SHOW}/download?torrentId=${torrent.id}`,
      cookies: owner,
    })

    expect(own.statusCode).toBe(200)
    expect(torrentRow(torrent.id)).toMatchObject({ retention: 'cache' })
  })

  it('закачки по раздачам: сезоны и фаза — качается, раскладывается, разложено', async () => {
    const torrent = await seed(
      'Example.Show.S01.1080p',
      [
        { path: 'Example.Show.S01E01.1080p.mkv', size: 3000 },
        { path: 'Example.Show.S01E02.1080p.mkv', size: 3000 },
      ],
      { titleId: SHOW, selectedFiles: [0, 1] },
    )

    const state = async (done: number) => {
      fetchMock.mockImplementationOnce(async () =>
        json([
          {
            infoHash: HASH,
            paused: false,
            selected: [0, 1],
            bytesCompleted: done,
            bytesWanted: 6000,
            wantedCompleted: done,
            seeding: true,
            peers: { connected: 3, found: 5, seeders: 1 },
            downloadSpeed: 200,
            uploadSpeed: 0,
            fileProgress: [3000, done - 3000],
          },
        ]),
      )

      return (
        await app.inject({
          url: `/api/titles/${SHOW}/download`,
          cookies: owner,
        })
      ).json()
    }

    expect((await state(4000)).downloads).toEqual([
      expect.objectContaining({
        torrentId: torrent.id,
        phase: 'downloading',
        seasons: [1],
        peers: { connected: 3, found: 5 },
        stalled: false,
      }),
    ])
    expect((await state(6000)).downloads).toEqual([
      expect.objectContaining({ phase: 'placing', progress: 1, speed: 0 }),
    ])

    progress = [3000, 3000]
    selected = [0, 1]
    await syncLibrary()
    expect((await state(6000)).downloads).toEqual([])
  })

  it('видео без номеров серий — «не разложится»', async () => {
    await seed(
      'Example.Show.S01.1080p',
      [{ path: 'Example.Show.Bonus.mkv', size: 3000 }],
      { titleId: SHOW, selectedFiles: [0] },
    )

    fetchMock.mockImplementationOnce(async () =>
      json([
        {
          infoHash: HASH,
          paused: false,
          selected: [0],
          bytesCompleted: 3000,
          bytesWanted: 3000,
          wantedCompleted: 3000,
          seeding: true,
          peers: { connected: 0, found: 0, seeders: 0 },
          downloadSpeed: 0,
          uploadSpeed: 0,
          fileProgress: [3000],
        },
      ]),
    )

    const res = await app.inject({
      url: `/api/titles/${SHOW}/download`,
      cookies: owner,
    })

    expect(res.json().downloads).toEqual([
      expect.objectContaining({ phase: 'unmatched', seasons: [1] }),
    ])
  })

  it('состояние называет раздачу, пиров и скорость', async () => {
    await seed(
      'Example.Show.S01.1080p.LostFilm',
      [{ path: 'Example.Show.S01E01.1080p.mkv', size: 3000 }],
      { titleId: SHOW, selectedFiles: [0] },
    )

    progress = [1000]
    selected = [0]
    fetchMock.mockImplementationOnce(async () =>
      json([
        {
          infoHash: HASH,
          paused: false,
          selected,
          bytesCompleted: 1000,
          bytesWanted: 3000,
          wantedCompleted: 1000,
          seeding: true,
          peers: { connected: 0, found: 4, seeders: 0 },
          downloadSpeed: 0,
          uploadSpeed: 0,
          fileProgress: progress,
        },
      ]),
    )

    const res = await app.inject({
      url: `/api/titles/${SHOW}/download`,
      cookies: owner,
    })

    expect(res.json()).toMatchObject({
      state: 'downloading',
      release: { quality: '1080p', voice: { studio: 'LostFilm' } },
      peers: { connected: 0, found: 4 },
      stalled: true,
    })
  })
})

describe('библиотека на витрине', () => {
  async function placedMovie() {
    await seed('Example Movie (2008)', movieFiles, {
      titleId: 'tmdb:movie:603',
      selectedFiles: [0],
    })
    progress = [4000, 10, 20]
    selected = [0]
    await syncLibrary()
    return rows()[0]!
  }

  it('файлы тайтла в библиотеке', async () => {
    const file = await placedMovie()
    const res = await app.inject({
      url: '/api/titles/tmdb:movie:603/library',
      cookies: owner,
    })

    expect(res.json()).toEqual({
      files: [
        {
          id: file.id,
          season: null,
          episode: null,
          episodeTo: null,
          quality: null,
          size: 4000,
          duration: null,
        },
      ],
    })
  })

  it('воспроизведение файла библиотеки: поток с диска с Range, без движка', async () => {
    const file = await placedMovie()

    setEngineDown('stopped')

    const res = await app.inject({
      method: 'POST',
      url: '/api/playback',
      cookies: owner,
      payload: { mediaFileId: file.id },
    })
    const body = res.json()

    expect(res.statusCode).toBe(200)
    expect(body).toMatchObject({ mode: 'direct', size: 4000 })
    expect(body.streamUrl).toMatch(
      new RegExp(`^/api/library/files/${file.id}/stream\\?token=`),
    )

    const stream = await app.inject({
      url: `/api/library/files/${file.id}/stream`,
      cookies: owner,
      headers: { range: 'bytes=10-19' },
    })

    expect(stream.statusCode).toBe(206)
    expect(stream.headers['content-range']).toBe('bytes 10-19/4000')
    expect(stream.rawPayload).toHaveLength(10)

    const outside = await app.inject({
      url: `/api/library/files/${file.id}/stream`,
      cookies: owner,
      headers: { range: 'bytes=5000-' },
    })

    expect(outside.statusCode).toBe(416)

    await app.inject({
      method: 'DELETE',
      url: `/api/playback/${body.sessionId}`,
      cookies: owner,
    })
  })

  it('позиция файла библиотеки — по тайтлу, «Продолжить» её видит', async () => {
    const file = await placedMovie()

    const res = await app.inject({
      method: 'PUT',
      url: '/api/watch-state',
      cookies: owner,
      payload: { mediaFileId: file.id, position: 600, duration: 1500 },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      torrentId: null,
      mediaFileId: file.id,
      position: 600,
    })

    const { titleProgress } = await import('../db/schema.ts')
    const saved = getDb().select().from(titleProgress).all()

    expect(saved).toEqual([
      expect.objectContaining({
        titleId: 'tmdb:movie:603',
        mediaFileId: file.id,
        torrentId: file.torrentId,
        position: 600,
      }),
    ])
    getDb().delete(titleProgress).run()
  })

  it('раздел «Библиотека»: ряды фильмов, без каталога', async () => {
    await placedMovie()

    const res = await app.inject({
      url: '/api/home?mode=library&language=en-US',
      cookies: owner,
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().rows.map((row: { id: string }) => row.id)).toEqual([
      'libraryRecent',
      'libraryMovies',
    ])
  })

  it('неизвестный файл библиотеки — 404', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/playback',
      cookies: owner,
      payload: { mediaFileId: 'missing' },
    })

    expect(res.statusCode).toBe(404)
  })
})

describe('распознавание раздач, добавленных в панели', () => {
  const movieResult = {
    id: 603,
    media_type: 'movie',
    title: 'Example Movie',
    original_title: 'Example Movie',
    release_date: '2008-05-01',
  }

  async function added(name = 'Example.Movie.2008.1080p') {
    const torrent = await seed(name, [{ path: `${name}.mkv`, size: 4000 }], {
      retention: 'keep',
      selectedFiles: [0],
    })

    progress = [4000]
    selected = [0]
    return torrent
  }

  it('имя раздачи узнаётся по алиасам кандидата — файл ложится в библиотеку', async () => {
    const { queueRecognition } = await import('../services/library/index.ts')

    searchResults['example movie'] = [movieResult]

    const torrent = await added()

    await queueRecognition(torrent.id)
    expect(torrentRow(torrent.id)).toMatchObject({
      titleId: 'tmdb:movie:603',
      matchStatus: 'matched',
    })

    await syncLibrary()
    expect(rows()).toEqual([
      expect.objectContaining({
        titleId: 'tmdb:movie:603',
        torrentId: torrent.id,
      }),
    ])
  })

  it('не узнали — `unmatched`, в библиотеку не кладём', async () => {
    const { queueRecognition } = await import('../services/library/index.ts')
    const torrent = await added('Unknown.Thing.2008.1080p')

    await queueRecognition(torrent.id)
    expect(torrentRow(torrent.id)).toMatchObject({
      titleId: null,
      matchStatus: 'unmatched',
    })
    await syncLibrary()
    expect(rows()).toEqual([])
  })

  it('год не сошёлся — «похоже», ждём подтверждения', async () => {
    const { recognizeRelease } = await import('../services/library/index.ts')

    searchResults['example movie'] = [movieResult]

    expect(await recognizeRelease('Example.Movie.2015.1080p')).toEqual({
      status: 'unsure',
      suggestion: 'tmdb:movie:603',
    })
  })

  it('подзаголовок в названии — ищем без него, но только «похоже»', async () => {
    const { recognizeRelease } = await import('../services/library/index.ts')

    searchResults['example show'] = [
      {
        id: 1396,
        media_type: 'tv',
        name: 'Example Show',
        original_name: 'Example Show',
        first_air_date: '2008-01-20',
      },
    ]

    expect(await recognizeRelease('Example Show. Island Season 2')).toEqual({
      status: 'unsure',
      suggestion: 'tmdb:tv:1396',
    })
  })

  it('«Исправить совпадение»: тайтл от владельца, название запоминается', async () => {
    const torrent = await added('Primer.Filma.2008.1080p')

    const res = await app.inject({
      method: 'PUT',
      url: `/api/torrents/${torrent.id}/title`,
      cookies: owner,
      payload: { titleId: 'tmdb:movie:603' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      titleId: 'tmdb:movie:603',
      matchStatus: 'user',
      matchSuggestion: null,
    })

    await syncLibrary()
    expect(rows()).toHaveLength(1)

    // То же название в другой раздаче узнаётся без поиска TMDB
    const { recognizeRelease } = await import('../services/library/index.ts')

    expect(await recognizeRelease('Primer.Filma.2008.720p')).toEqual({
      status: 'matched',
      titleId: 'tmdb:movie:603',
    })
  })

  it('«не фильм и не сериал» — без тайтла, файлы переложены в other/', async () => {
    const torrent = await added()

    await app.inject({
      method: 'PUT',
      url: `/api/torrents/${torrent.id}/title`,
      cookies: owner,
      payload: { titleId: 'tmdb:movie:603' },
    })
    await syncLibrary()
    expect(rows()).toHaveLength(1)

    const res = await app.inject({
      method: 'PUT',
      url: `/api/torrents/${torrent.id}/title`,
      cookies: owner,
      payload: { titleId: null },
    })

    expect(res.json()).toMatchObject({ titleId: null, matchStatus: 'ignored' })

    // Видео «не фильма» — в `other/` без тайтла: на витрине «Без описания»
    await syncLibrary()
    expect(rows()).toEqual([
      expect.objectContaining({
        relPath: 'other/Example.Movie.2008.1080p/Example.Movie.2008.1080p.mkv',
        titleId: null,
        matchStatus: 'ignored',
      }),
    ])
  })
})

describe('«Указать тайтл» с витрины', () => {
  async function release(name: string, values: Partial<Torrent> = {}) {
    return seed(
      name,
      [
        { path: 'Example Show S01E01.mkv', size: 4000 },
        { path: 'Example Show S01E02.mkv', size: 3000 },
      ],
      {
        infoHash: randomUUID().replaceAll('-', '').padEnd(40, '0'),
        retention: 'keep',
        selectedFiles: [0],
        ...values,
      },
    )
  }

  // Устройство с профилем: возрастной порог — у профиля
  async function tv(ageLimit: 6 | 12 | 16 | 18 | null) {
    const { createProfile } = await import('../services/profiles/index.ts')
    const { hashToken } = await import('../services/devices/index.ts')
    const profile = createProfile({
      name: `TV ${ageLimit}`,
      color: 'violet',
      language: null,
      ageLimit,
    })
    const token = `token-${randomUUID()}`

    getDb()
      .insert(devices)
      .values({
        name: 'TV',
        type: 'tv',
        tokenHash: hashToken(token),
        profileId: profile.id,
      })
      .run()

    return { [DEVICE_TOKEN_COOKIE]: token }
  }

  function libraryRows(cookies: Record<string, string>) {
    return app.inject({
      url: '/api/home?mode=library&language=en-US',
      cookies,
    })
  }

  it('ряд — нераспознанные скачанные раздачи, «похоже» первыми', async () => {
    const unmatched = await release('Unknown Thing S01', {
      matchStatus: 'unmatched',
    })
    const unsure = await release('Example Show. Island S01', {
      matchStatus: 'unsure',
      // У фильма в моках TMDB полные детали — карточка подсказки строится
      matchSuggestion: 'tmdb:movie:603',
    })

    await release('Ignored Thing S01', { matchStatus: 'ignored' })
    await release('Cached Thing S01', {
      matchStatus: 'unmatched',
      retention: 'cache',
    })

    const res = await libraryRows(owner)
    const row = res
      .json()
      .rows
      .find((item: { id: string }) => item.id === 'libraryUnmatched')

    expect(row.kind).toBe('releases')
    expect(row.items).toEqual([
      expect.objectContaining({
        torrentId: unsure.id,
        matchStatus: 'unsure',
        suggestion: expect.objectContaining({ id: 'tmdb:movie:603' }),
        query: 'Example Show',
        seasons: [1],
        videos: 1,
        size: 4000,
      }),
      expect.objectContaining({
        torrentId: unmatched.id,
        matchStatus: 'unmatched',
        suggestion: null,
      }),
    ])
  })

  it('профиль с возрастным порогом: ряда нет, тайтл не меняет', async () => {
    const torrent = await release('Unknown Thing S01', {
      matchStatus: 'unmatched',
    })
    const kid = await tv(12)

    const res = await libraryRows(kid)

    expect(
      res
        .json()
        .rows.some((row: { id: string }) => row.id === 'libraryUnmatched'),
    ).toBe(false)

    const put = await app.inject({
      method: 'PUT',
      url: `/api/torrents/${torrent.id}/title`,
      cookies: kid,
      payload: { titleId: 'tmdb:tv:1396' },
    })

    expect(put.statusCode).toBe(403)
    expect(torrentRow(torrent.id)).toMatchObject({ titleId: null })
  })

  it('профиль без порога указывает тайтл — файлы в библиотеке', async () => {
    // Хеш, который знает движок в тестах: связыватель берёт прогресс у него
    const torrent = await release('Unknown Thing S01', {
      infoHash: HASH,
      matchStatus: 'unmatched',
    })

    progress = [4000, 0]
    selected = [0]

    const adult = await tv(null)
    const put = await app.inject({
      method: 'PUT',
      url: `/api/torrents/${torrent.id}/title`,
      cookies: adult,
      payload: { titleId: 'tmdb:tv:1396' },
    })

    expect(put.statusCode).toBe(200)
    expect(put.json()).toMatchObject({ matchStatus: 'user' })

    await syncLibrary()
    expect(rows()).toEqual([
      expect.objectContaining({
        titleId: 'tmdb:tv:1396',
        season: 1,
        episode: 1,
      }),
    ])
  })
})
