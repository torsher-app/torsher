import { Buffer } from 'node:buffer'
import { execFile, execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
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
  metaCache,
  titleAliases,
  users,
} from '../db/schema.ts'
import {
  albumOf,
  applyHomeVideoFields,
  capturedOf,
  parseNameDate,
  parseTagDate,
} from '../services/library/homeVideo.ts'
import {
  matchIdle,
  queueMatch,
  releaseGroups,
} from '../services/library/match.ts'
import { scanFolder } from '../services/library/scan.ts'
import { installLogger } from '../services/logs/index.ts'
import { signToken } from '../utils/token.ts'

const ffmpegAvailable = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    return true
  }
  catch {
    return false
  }
})()

const app = createApp()
const fetchMock = vi.fn<typeof fetch>()
const owner = { [ACCESS_TOKEN_COOKIE]: signToken('owner', 'user_access') }
let root = ''

// Поиск TMDB по названию: запрос в нижнем регистре
let searchResults: Record<string, object[]> = {}

const identities: Record<string, object> = {
  '/3/movie/603': {
    id: 603,
    title: 'Example Movie',
    original_title: 'Example Movie',
    original_language: 'en',
    release_date: '2008-05-01',
  },
  '/3/tv/1396': {
    id: 1396,
    name: 'Example Show',
    original_name: 'Example Show',
    original_language: 'en',
    first_air_date: '2008-01-20',
    seasons: [
      { season_number: 1, episode_count: 7 },
      { season_number: 2, episode_count: 13 },
    ],
  },
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

async function file(path: string, size = 1000) {
  const full = join(root, 'media', ...path.split('/'))

  await mkdir(dirname(full), { recursive: true })
  await writeFile(full, Buffer.alloc(size, 1))
}

function rows() {
  return getDb().select().from(mediaFiles).orderBy(mediaFiles.relPath).all()
}

async function addLibrary(payload: object = {}) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/libraries',
    cookies: owner,
    payload: {
      kind: 'video',
      name: 'Фильмы',
      path: join(root, 'media'),
      ...payload,
    },
  })

  return res
}

async function scanned(res: Awaited<ReturnType<typeof addLibrary>>) {
  const folderId = res.json().folders[0].id as string

  await scanFolder(folderId)

  return folderId
}

beforeAll(async () => {
  await migrateDb()
  getDb()
    .insert(users)
    .values({
      id: 'owner',
      name: 'Owner',
      email: 'owner@example.com',
      passwordHash: 'hash',
    })
    .onConflictDoNothing()
    .run()
})

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'torsher-folders-'))
  await mkdir(join(root, 'media'), { recursive: true })
  vi.stubEnv('TMDB_ACCESS_TOKEN', 'test-token')
  searchResults = {}
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input) => {
    const url = new URL(String(input))

    if (url.hostname !== 'api.themoviedb.org')
      return json({}, 404)

    if (url.pathname === '/3/search/multi') {
      return json({
        results: searchResults[url.searchParams.get('query') ?? ''] ?? [],
      })
    }

    if (url.pathname === '/3/find/tt0133093') {
      return json({ movie_results: [{ id: 603 }], tv_results: [] })
    }

    const found = identities[url.pathname]

    return found ? json(found) : json({}, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  getDb().delete(libraries).run()
  getDb().delete(metaCache).run()
  getDb().delete(titleAliases).run()
})

afterEach(async () => {
  await matchIdle()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  installLogger(pino({ level: 'silent' }))
  await rm(root, { recursive: true, force: true })
})

describe('подключённые папки: скан', () => {
  it('папка индексируется на месте: видео, без скрытых, служебных и исключённых', async () => {
    await file('Example Movie (2008)/Example.Movie.2008.1080p.mkv')
    await file('Example Movie (2008)/Example.Movie.2008.rus.srt')
    await file('.hidden/Secret.mkv')
    await file('@eaDir/Thumb.mkv')
    await file('Trash/Old.mkv')

    const res = await addLibrary()

    expect(res.statusCode).toBe(200)

    await app.inject({
      method: 'PATCH',
      url: `/api/libraries/${res.json().id}`,
      cookies: owner,
      payload: { exclude: ['Trash/**'] },
    })
    await scanned(res)

    // Попавшее под исключение после первого скана — пропавшее, не удалённое
    expect(
      rows()
        .filter(row => row.state === 'present')
        .map(row => row.relPath),
    ).toEqual(['Example Movie (2008)/Example.Movie.2008.1080p.mkv'])
  })

  it('пустая папка — «Пусто», а опустевшая после файлов — «Недоступно», ничего не удаляется', async () => {
    const res = await addLibrary()
    const folderId = await scanned(res)
    const list = async () =>
      (await app.inject({ url: '/api/libraries', cookies: owner })).json().items[0].folders[0]

    expect(await list()).toMatchObject({ status: 'empty', files: 0 })

    await file('Example.Movie.2008.mkv')
    await scanFolder(folderId)
    expect(await list()).toMatchObject({ status: 'ok', files: 1 })

    await rm(join(root, 'media', 'Example.Movie.2008.mkv'))
    await scanFolder(folderId)
    expect(await list()).toMatchObject({
      status: 'offline',
      files: 0,
      missing: 1,
    })
    expect(rows()).toEqual([expect.objectContaining({ state: 'missing' })])

    await file('Example.Movie.2008.mkv')
    await scanFolder(folderId)
    expect(rows()).toEqual([expect.objectContaining({ state: 'present' })])
  })

  it('пропал путь — «Недоступно»; переименование узнаётся по inode', async () => {
    await file('Old Name/Example.Movie.2008.mkv')

    const res = await addLibrary()
    const folderId = await scanned(res)
    const [before] = rows()

    await rename(
      join(root, 'media', 'Old Name'),
      join(root, 'media', 'New Name'),
    )
    await scanFolder(folderId)

    expect(rows()).toEqual([
      expect.objectContaining({
        id: before!.id,
        relPath: 'New Name/Example.Movie.2008.mkv',
        state: 'present',
      }),
    ])

    await rm(join(root, 'media'), { recursive: true })

    const result = await scanFolder(folderId)

    expect(result?.status).toBe('offline')
    expect(rows()).toEqual([expect.objectContaining({ state: 'missing' })])
  })

  it('путь проверяется: нет папки, относительный, та же папка дважды — 422', async () => {
    expect(
      (await addLibrary({ path: join(root, 'nope') })).json(),
    ).toMatchObject({ kind: 'missing' })
    expect((await addLibrary({ path: 'media' })).json()).toMatchObject({
      kind: 'not_absolute',
    })
    expect((await addLibrary()).statusCode).toBe(200)
    expect((await addLibrary()).json()).toMatchObject({ kind: 'duplicate' })
  })

  it('обзор ФС — только каталоги, токен устройства не пускает', async () => {
    await file('Folder/Example.mkv')

    const res = await app.inject({
      url: `/api/storage/browse?path=${encodeURIComponent(join(root, 'media'))}`,
      cookies: owner,
    })

    expect(res.json()).toMatchObject({
      entries: [{ name: 'Folder' }],
      parent: root,
    })
    expect((await app.inject({ url: '/api/storage/browse' })).statusCode).toBe(
      401,
    )
  })
})

describe('подключённые папки: сопоставление', () => {
  it('релизы: папка фильма, папки сезонов внутри сериала, россыпь фильмов', () => {
    const groups = releaseGroups([
      'Example Movie (2008)/Example.Movie.2008.mkv',
      'Example Show/Season 01/Example.Show.S01E01.mkv',
      'Example Show/Season 02/Example.Show.S02E01.mkv',
      'Фильмы/Example.Movie.2008.mkv',
      'Фильмы/Other.Film.2010.mkv',
      'Root.Film.2001.mkv',
    ])

    expect([...groups.keys()].sort()).toEqual([
      'Example Movie (2008)',
      'Example Show',
      'Root.Film.2001.mkv',
      'Фильмы/Example.Movie.2008.mkv',
      'Фильмы/Other.Film.2010.mkv',
    ])
  })

  it('по имени: фильм узнан, сериал разложен по сезонам и сериям', async () => {
    searchResults['example movie'] = [
      {
        id: 603,
        media_type: 'movie',
        title: 'Example Movie',
        release_date: '2008-05-01',
      },
    ]
    searchResults['example show'] = [
      {
        id: 1396,
        media_type: 'tv',
        name: 'Example Show',
        first_air_date: '2008-01-20',
      },
    ]
    await file('Example Movie (2008)/Example.Movie.2008.1080p.mkv')
    await file('Example Show (2008)/Season 01/Example.Show.S01E01.mkv')
    await file('Example Show (2008)/Season 02/Example.Show.S02E03.mkv')

    const folderId = await scanned(await addLibrary())

    await queueMatch(
      folderId,
      rows().map(row => row.id),
    )

    expect(
      rows().map(row => [
        row.titleId,
        row.season,
        row.episode,
        row.matchSource,
      ]),
    ).toEqual([
      ['tmdb:movie:603', 0, 0, 'parser'],
      ['tmdb:tv:1396', 1, 1, 'parser'],
      ['tmdb:tv:1396', 2, 3, 'parser'],
    ])
  })

  it('iD в имени и NFO — сильнее разбора', async () => {
    await file('Whatever [tmdbid-603]/movie.mkv')
    await file('Unknown/film.mkv')
    await writeFile(
      join(root, 'media', 'Unknown', 'movie.nfo'),
      '<movie><uniqueid type="imdb">tt0133093</uniqueid></movie>',
    )

    const folderId = await scanned(await addLibrary())

    await queueMatch(
      folderId,
      rows().map(row => row.id),
    )

    expect(
      rows().map(row => [row.relPath, row.titleId, row.matchSource]),
    ).toEqual([
      ['Unknown/film.mkv', 'tmdb:movie:603', 'nfo'],
      ['Whatever [tmdbid-603]/movie.mkv', 'tmdb:movie:603', 'name_id'],
    ])
  })

  it('не узнали — «Нераспознанное»; «Исправить» запоминает название для другой папки', async () => {
    await file('Primer Filma (2008)/Primer.Filma.2008.mkv')

    const folderId = await scanned(await addLibrary())

    await queueMatch(
      folderId,
      rows().map(row => row.id),
    )

    const unmatched = await app.inject({
      url: '/api/libraries/unmatched',
      cookies: owner,
    })

    expect(unmatched.json().items).toEqual([
      expect.objectContaining({
        group: 'Primer Filma (2008)',
        status: 'unmatched',
        files: 1,
      }),
    ])

    const put = await app.inject({
      method: 'PUT',
      url: '/api/libraries/groups/title',
      cookies: owner,
      payload: {
        folderId,
        group: 'Primer Filma (2008)',
        titleId: 'tmdb:movie:603',
      },
    })

    expect(put.statusCode).toBe(204)
    expect(rows()[0]).toMatchObject({
      titleId: 'tmdb:movie:603',
      matchSource: 'user',
    })

    // Та же картина в другой папке узнаётся по алиасу владельца
    await file('Copy/Primer Filma (2008)/Primer.Filma.2008.720p.mkv')
    await scanFolder(folderId)
    await queueMatch(
      folderId,
      rows()
        .filter(row => !row.matchStatus)
        .map(row => row.id),
    )

    expect(rows().find(row => row.relPath.startsWith('Copy/'))).toMatchObject(
      {
        titleId: 'tmdb:movie:603',
      },
    )
  })
})

describe('«Исправить совпадение»: номера серий', () => {
  it('предпросмотр раскладки и сохранение с исправленными номерами', async () => {
    await file('Unknown Show/Unknown.Show.S01E01.mkv')
    await file('Unknown Show/Unknown.Show.S01E02.mkv')
    await file('Unknown Show/Bonus.mkv')

    const folderId = await scanned(await addLibrary())

    await queueMatch(
      folderId,
      rows().map(row => row.id),
    )

    const preview = await app.inject({
      url: `/api/libraries/groups/preview?folderId=${folderId}&group=${encodeURIComponent('Unknown Show')}&titleId=tmdb:tv:1396`,
      cookies: owner,
    })

    expect(
      preview
        .json()
        .items.map(
          (item: {
            relPath: string
            season: number | null
            episode: number | null
          }) => [item.relPath, item.season, item.episode],
        ),
    ).toEqual([
      ['Unknown Show/Bonus.mkv', null, null],
      ['Unknown Show/Unknown.Show.S01E01.mkv', 1, 1],
      ['Unknown Show/Unknown.Show.S01E02.mkv', 1, 2],
    ])

    const [bonus, first, second] = preview.json().items as Array<{
      id: string
    }>
    const put = await app.inject({
      method: 'PUT',
      url: '/api/libraries/groups/title',
      cookies: owner,
      payload: {
        folderId,
        group: 'Unknown Show',
        titleId: 'tmdb:tv:1396',
        episodes: [
          { id: bonus!.id, season: 0, episode: 1 },
          { id: first!.id, season: 2, episode: 5 },
          { id: second!.id, season: 1, episode: null },
        ],
      },
    })

    expect(put.statusCode).toBe(204)
    expect(
      rows().map(row => [row.relPath, row.titleId, row.season, row.episode]),
    ).toEqual([
      ['Unknown Show/Bonus.mkv', 'tmdb:tv:1396', 0, 1],
      ['Unknown Show/Unknown.Show.S01E01.mkv', 'tmdb:tv:1396', 2, 5],
      ['Unknown Show/Unknown.Show.S01E02.mkv', null, null, null],
    ])

    // «Не серия» владельца в «Нераспознанное» не возвращается
    const unmatched = await app.inject({
      url: '/api/libraries/unmatched',
      cookies: owner,
    })

    expect(unmatched.json().items).toEqual([])
  })
})

describe('домашнее видео', () => {
  it('дата съёмки: теги с зоной и без, ложные даты, имя файла, время файла', () => {
    expect(
      new Date(parseTagDate('2023-07-14T15:30:12+0300')!).toISOString(),
    ).toBe('2023-07-14T15:30:12.000Z')
    expect(
      new Date(parseTagDate('2023-07-14T12:30:12.000000Z')!).toISOString(),
    ).toBe('2023-07-14T12:30:12.000Z')
    expect(parseTagDate('1904-01-01T00:00:00.000000Z')).toBeUndefined()
    expect(parseTagDate('1970-01-01T00:00:00.000000Z')).toBeUndefined()
    expect(parseTagDate('2000-01-01T00:00:00Z')).toBeUndefined()
    expect(parseTagDate('2999-01-01T00:00:00Z')).toBeUndefined()

    const day = (name: string) => {
      const at = parseNameDate(name)

      return at === undefined
        ? undefined
        : new Date(at).toISOString().slice(0, 19)
    }

    expect(day('VID_20230714_153012.mp4')).toBe('2023-07-14T15:30:12')
    expect(day('PXL_20230714_153012345.mp4')).toBe('2023-07-14T15:30:12')
    expect(day('WhatsApp Video 2023-07-14 at 15.30.12.mp4')).toBe(
      '2023-07-14T15:30:12',
    )
    expect(day('DJI_20230714153012_0001.mp4')).toBe('2023-07-14T15:30:12')
    expect(day('VID-20230714-WA0001.mp4')).toBe('2023-07-14T00:00:00')
    expect(day('holiday.mp4')).toBeUndefined()

    expect(
      capturedOf(null, 'holiday.mp4', new Date(2021, 4, 2, 10, 0, 0)),
    ).toEqual({
      at: new Date(Date.UTC(2021, 4, 2, 10, 0, 0)),
      source: 'file',
    })
    expect(albumOf('Отпуск 2019/День 1/clip.mp4')).toBe('Отпуск 2019/День 1')
    expect(albumOf('clip.mp4')).toBe('')
  })

  it('альбомы — папки, видео по дате, ряд в «Библиотеке», скрытая от профиля не видна', async () => {
    await file('Отпуск 2019/VID_20190714_153012.mp4')
    await file('Отпуск 2019/VID_20190716_101500.mp4')
    await file('PXL_20230101_120000000.mp4')

    const res = await addLibrary({ kind: 'home', name: 'Семья' })
    // Новые файлы домашнего видео получают дату и альбом после скана (main.ts)
    await scanFolder(res.json().folders[0].id as string)
    applyHomeVideoFields(rows().map(row => row.id))

    const albums = (
      await app.inject({ url: '/api/library/home', cookies: owner })
    ).json().albums

    expect(albums).toEqual([
      expect.objectContaining({ album: '', count: 1 }),
      expect.objectContaining({
        album: 'Отпуск 2019',
        count: 2,
        from: '2019-07-14T15:30:12.000Z',
        to: '2019-07-16T10:15:00.000Z',
      }),
    ])

    const videos = await app.inject({
      url: `/api/library/home/videos?album=${encodeURIComponent('Отпуск 2019')}`,
      cookies: owner,
    })

    expect(
      videos.json().items.map((item: { name: string }) => item.name),
    ).toEqual(['VID_20190716_101500', 'VID_20190714_153012'])

    const home = await app.inject({
      url: '/api/home?mode=library&language=en-US',
      cookies: owner,
    })

    expect(home.json().rows.map((row: { id: string }) => row.id)).toContain(
      'libraryHomeVideo',
    )

    const { defaultProfile } = await import('../services/profiles/index.ts')

    await app.inject({
      method: 'PATCH',
      url: `/api/libraries/${res.json().id}`,
      cookies: owner,
      payload: { hiddenProfiles: [defaultProfile().id] },
    })

    expect(
      (await app.inject({ url: '/api/library/home', cookies: owner })).json()
        .albums,
    ).toEqual([])
  })

  it('дату правит владелец; «вернуть» — снова автоматическая', async () => {
    await file('VID_20190714_153012.mp4')

    const res = await addLibrary({ kind: 'home', name: 'Семья' })
    await scanFolder(res.json().folders[0].id)
    applyHomeVideoFields(rows().map(row => row.id))

    const [row] = rows()
    const patch = (capturedAt: string | null) =>
      app.inject({
        method: 'PATCH',
        url: `/api/libraries/files/${row!.id}`,
        cookies: owner,
        payload: { capturedAt },
      })

    expect((await patch('2018-05-01T12:00:00.000Z')).statusCode).toBe(204)
    expect(rows()[0]).toMatchObject({ capturedAtSource: 'user' })
    expect(rows()[0]!.capturedAt!.toISOString()).toBe(
      '2018-05-01T12:00:00.000Z',
    )

    await patch(null)
    expect(rows()[0]).toMatchObject({ capturedAtSource: 'name' })
  })

  it('видео без тайтла — в «Без описания»', async () => {
    await file('Concert.Live.mkv')

    const folderId = await scanned(await addLibrary())

    await queueMatch(
      folderId,
      rows().map(row => row.id),
    )

    const home = await app.inject({
      url: '/api/home?mode=library&language=en-US',
      cookies: owner,
    })
    const row = home
      .json()
      .rows
      .find((item: { id: string }) => item.id === 'libraryUntitled')

    expect(row.items).toEqual([
      expect.objectContaining({
        name: 'Concert.Live',
        thumb: expect.stringContaining('/thumb'),
      }),
    ])
  })

  it.skipIf(!ffmpegAvailable)(
    'кадр-превью делает ffmpeg и кладёт в кэш',
    async () => {
      const path = join(root, 'media', 'clip.mp4')

      await new Promise<void>((resolve, reject) => {
        execFile(
          'ffmpeg',
          [
            '-v',
            'error',
            '-f',
            'lavfi',
            '-i',
            'testsrc=duration=3:size=320x240:rate=10',
            '-y',
            path,
          ],
          err => (err ? reject(err) : resolve()),
        )
      })
      vi.stubEnv('FFMPEG_PATH', 'ffmpeg')

      const res = await addLibrary({ kind: 'home', name: 'Семья' })

      await scanFolder(res.json().folders[0].id)

      const thumb = await app.inject({
        url: `/api/library/files/${rows()[0]!.id}/thumb`,
        cookies: owner,
      })

      expect(thumb.statusCode).toBe(200)
      expect(thumb.headers['content-type']).toBe('image/jpeg')
      expect(thumb.rawPayload.length).toBeGreaterThan(1000)
    },
  )
})
