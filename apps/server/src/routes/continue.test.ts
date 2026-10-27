import type { TorrentFileEntry } from '../db/schema.ts'
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
  metaCache,
  profileTitles,
  titleProgress,
  torrents,
  users,
} from '../db/schema.ts'
import {
  markWatched,
  saveTitleProgress,
} from '../services/sources/progress.ts'
import { CONTINUE_MAX_AGE_DAYS } from '../services/sources/continue.ts'
import { nextAiredEpisode, resumeTarget } from '../services/sources/resume.ts'
import { isWatched } from '../services/torrents/playback.ts'
import {
  emptyList,
  movie,
  season,
  tvOngoing,
} from '../services/tmdb/fixtures/index.ts'
import { signToken } from '../utils/token.ts'

const app = createApp()
const fetchMock = vi.fn<typeof fetch>()
const owner = { [ACCESS_TOKEN_COOKIE]: signToken('owner', 'user_access') }
// Идущий сериал: первый сезон вышел целиком (8), из второго — 4 серии
const SERIES = 'tmdb:tv:2000'
const MOVIE = 'tmdb:movie:603'
const EPISODE = 52 * 60
const DAY_MS = 24 * 60 * 60 * 1000

let profileId = ''
let tmdbDown = false

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function packFiles(seasonNumber: number, count: number): TorrentFileEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    path: `Long.Orbit.S0${seasonNumber}/Long.Orbit.S0${seasonNumber}E0${i + 1}.1080p.mkv`,
    size: 2_000_000_000,
    padding: false,
  }))
}

function addTorrent(id: string, name: string, files: TorrentFileEntry[]) {
  getDb()
    .insert(torrents)
    .values({
      id,
      infoHash: id.padEnd(40, '0'),
      name,
      source: 'magnet',
      status: 'ready',
      files,
      pieceLength: 4_194_304,
    })
    .run()
}

function watched(
  titleId: string,
  seasonNumber: number,
  episode: number,
  position: number,
  updatedAt = new Date(),
  torrentId = 's2',
  fileIndex = episode - 1,
) {
  getDb()
    .insert(titleProgress)
    .values({
      profileId,
      titleId,
      season: seasonNumber,
      episode,
      position,
      duration: EPISODE,
      torrentId,
      fileIndex,
      // Как пишет плеер: отметка — по порогу досмотра
      watchedAt: isWatched(position, EPISODE) ? updatedAt : null,
      updatedAt,
    })
    .run()
}

async function continueItems(search = '') {
  const res = await app.inject({
    url: `/api/home/continue${search}`,
    cookies: owner,
  })

  expect(res.statusCode).toBe(200)

  return res.json().items
}

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

  const profiles = await app.inject({ url: '/api/profiles', cookies: owner })

  profileId = profiles.json().currentId
})

beforeEach(() => {
  tmdbDown = false
  getDb().delete(titleProgress).run()
  getDb().delete(profileTitles).run()
  getDb().delete(torrents).run()
  getDb().delete(metaCache).run()
  addTorrent('s1', 'Long.Orbit.S01.1080p.WEB-DL', packFiles(1, 8))
  addTorrent('s2', 'Long.Orbit.S02.1080p.WEB-DL', packFiles(2, 4))
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input) => {
    const url = new URL(String(input))

    if (tmdbDown)
      return json({ status_message: 'down' }, 500)

    if (url.pathname === '/3/tv/2000')
      return json(tvOngoing)

    if (url.pathname === '/3/tv/2000/season/2')
      return json(season)

    if (url.pathname === '/3/movie/603')
      return json(movie)

    return json(emptyList)
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('TMDB_ACCESS_TOKEN', 'test-token')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('nextAiredEpisode', () => {
  const seasons = [
    { number: 1, airedEpisodeCount: 8 },
    { number: 2, airedEpisodeCount: 4 },
    { number: 3, airedEpisodeCount: 0 },
  ]

  it('следующая в сезоне, потом первая следующего', () => {
    expect(nextAiredEpisode(seasons, { season: 1, episode: 3 })).toEqual({
      season: 1,
      episode: 4,
    })
    expect(nextAiredEpisode(seasons, { season: 1, episode: 8 })).toEqual({
      season: 2,
      episode: 1,
    })
  })

  it('невышедших серий нет, просмотренные пропускаются', () => {
    expect(
      nextAiredEpisode(seasons, { season: 2, episode: 4 }),
    ).toBeUndefined()
    expect(
      nextAiredEpisode(
        seasons,
        { season: 2, episode: 1 },
        ref => ref.episode === 2,
      ),
    ).toEqual({ season: 2, episode: 3 })
  })
})

describe('get /api/home/continue', () => {
  it('отвечает 401 без входа', async () => {
    const res = await app.inject({ url: '/api/home/continue' })

    expect(res.statusCode).toBe(401)
  })

  it('начатая серия: позиция, кадр, название и файл раздачи', async () => {
    watched(SERIES, 2, 1, 600)

    expect(await continueItems('?language=ru-RU')).toEqual([
      expect.objectContaining({
        id: SERIES,
        kind: 'series',
        title: 'Долгая орбита',
        season: 2,
        episode: 1,
        episodeTitle: 'Пробуждение',
        image: '/api/img/w300/still1.jpg',
        position: 600,
        duration: EPISODE,
        next: false,
        file: { torrentId: 's2', fileIndex: 0 },
      }),
    ])
  })

  it('досмотренная серия ведёт к следующей из той же раздачи', async () => {
    watched(SERIES, 2, 1, EPISODE - 30)

    expect(await continueItems()).toEqual([
      expect.objectContaining({
        season: 2,
        episode: 2,
        position: 0,
        next: true,
        file: { torrentId: 's2', fileIndex: 1 },
      }),
    ])
  })

  it('конец сезона — первая серия следующего, раздачу ещё искать', async () => {
    watched(SERIES, 1, 8, EPISODE, new Date(), 's1', 7)

    expect(await continueItems()).toEqual([
      expect.objectContaining({
        season: 2,
        episode: 1,
        next: true,
        file: null,
      }),
    ])
  })

  it('отмеченная с карточки серия пропускается', async () => {
    watched(SERIES, 2, 1, EPISODE)
    markWatched({ profileId, titleId: SERIES, season: 2, episode: 2 }, true)

    expect(await continueItems()).toEqual([
      expect.objectContaining({ season: 2, episode: 3 }),
    ])
  })

  it('короткий повторный запуск просмотренной серии ряд не откатывает', async () => {
    watched(SERIES, 2, 1, EPISODE, new Date(Date.now() - 60_000))
    saveTitleProgress(
      { profileId, titleId: SERIES, season: 2, episode: 1 },
      { position: 10, duration: EPISODE, torrentId: 's2', fileIndex: 0 },
    )

    expect(await continueItems()).toEqual([
      expect.objectContaining({ season: 2, episode: 2, next: true }),
    ])
  })

  it('пересмотр с места просмотренной серии продолжается', async () => {
    watched(SERIES, 2, 1, EPISODE, new Date(Date.now() - 60_000))
    saveTitleProgress(
      { profileId, titleId: SERIES, season: 2, episode: 1 },
      { position: 900, duration: EPISODE, torrentId: 's2', fileIndex: 0 },
    )

    expect(await continueItems()).toEqual([
      expect.objectContaining({
        season: 2,
        episode: 1,
        position: 900,
        next: false,
      }),
    ])
  })

  it('без вышедших серий и досмотренного фильма тайтла в ряду нет', async () => {
    watched(SERIES, 2, 4, EPISODE)
    watched(MOVIE, 0, 0, 7900, new Date(), 's1', 0)

    expect(await continueItems()).toEqual([])
  })

  it('фильм, остановленный на титрах, из ряда уходит', async () => {
    watched(MOVIE, 0, 0, EPISODE - 5 * 60, new Date(), 's1', 0)

    expect(await continueItems()).toEqual([])
  })

  it('фильм в первых 5% в ряд не попадает', async () => {
    watched(MOVIE, 0, 0, 120, new Date(), 's1', 0)

    expect(await continueItems()).toEqual([])
  })

  it('серия в первых 5% — в ряду с начала', async () => {
    watched(SERIES, 2, 1, 120)

    expect(await continueItems()).toEqual([
      expect.objectContaining({
        season: 2,
        episode: 1,
        position: 0,
        next: false,
      }),
    ])
  })

  it('свежие первыми, «Сериалы» без фильмов', async () => {
    watched(SERIES, 2, 1, 600, new Date(Date.now() - 2 * DAY_MS))
    watched(MOVIE, 0, 0, 1200, new Date(Date.now() - DAY_MS), 's1', 0)

    const all = await continueItems()

    expect(all.map((item: { id: string }) => item.id)).toEqual([MOVIE, SERIES])
    expect(all[0]).toMatchObject({
      season: null,
      episode: null,
      image: '/api/img/w780/tlm8UkiQsitc8rSuIAscQDCnP8d.jpg',
    })
    expect(
      (await continueItems('?mode=series')).map(
        (item: { id: string }) => item.id,
      ),
    ).toEqual([SERIES])
  })

  it('«Брошено» убирает тайтл, новый просмотр возвращает', async () => {
    watched(SERIES, 2, 1, 600, new Date(Date.now() - 60_000))

    const drop = await app.inject({
      method: 'PATCH',
      url: `/api/titles/${SERIES}/mine`,
      cookies: owner,
      payload: { dropped: true },
    })

    expect(drop.statusCode).toBe(200)
    expect(await continueItems()).toEqual([])

    getDb().delete(titleProgress).run()
    watched(SERIES, 2, 1, 900, new Date(Date.now() + 60_000))

    expect(await continueItems()).toEqual([
      expect.objectContaining({ id: SERIES, position: 900 }),
    ])
  })

  it('тайтл без просмотров дольше 16 недель — только в «Моё», ряд даёт число', async () => {
    watched(SERIES, 2, 1, 600)
    watched(
      MOVIE,
      0,
      0,
      1200,
      new Date(Date.now() - (CONTINUE_MAX_AGE_DAYS + 1) * DAY_MS),
      's1',
      0,
    )

    const res = await app.inject({
      url: '/api/home/continue',
      cookies: owner,
    })

    expect(res.json()).toMatchObject({ items: [{ id: SERIES }], total: 2 })

    const mine = await app.inject({
      url: '/api/mine/items?section=continue',
      cookies: owner,
    })

    expect(mine.json().items.map((item: { id: string }) => item.id)).toEqual([
      SERIES,
      MOVIE,
    ])

    // В «Сериалах» — число сериалов; у «Библиотеки» раздела-двойника нет
    const series = await app.inject({
      url: '/api/home/continue?mode=series',
      cookies: owner,
    })

    expect(series.json()).toMatchObject({ items: [{ id: SERIES }], total: 1 })

    const library = await app.inject({
      url: '/api/home/continue?mode=library',
      cookies: owner,
    })

    expect(library.json()).not.toHaveProperty('total')
  })

  it('всё в ряду — без числа', async () => {
    watched(SERIES, 2, 1, 600)

    const res = await app.inject({
      url: '/api/home/continue',
      cookies: owner,
    })

    expect(res.json().items).toHaveLength(1)
    expect(res.json()).not.toHaveProperty('total')
  })

  it('чужой профиль прогресса не видит', async () => {
    watched(SERIES, 2, 1, 600)

    expect(
      await resumeTarget('someone-else', SERIES, async () => []),
    ).toBeUndefined()
  })
})

describe('get /api/home', () => {
  it('«Продолжить» — первым рядом', async () => {
    watched(SERIES, 2, 1, 600)

    const res = await app.inject({ url: '/api/home', cookies: owner })

    expect(res.statusCode).toBe(200)
    expect(res.json().rows[0]).toMatchObject({
      id: 'continue',
      kind: 'continue',
      title: 'home.rows.continue',
    })
  })

  it('без сети отдаёт «Продолжить» из кэша', async () => {
    watched(SERIES, 2, 1, 600)
    await continueItems()
    tmdbDown = true

    const res = await app.inject({ url: '/api/home', cookies: owner })

    expect(res.statusCode).toBe(200)
    expect(res.json().rows.map((row: { id: string }) => row.id)).toEqual([
      'continue',
    ])
  })
})

describe('get /api/titles/:id/progress', () => {
  it('resume — следующая серия после досмотренной', async () => {
    watched(SERIES, 2, 1, EPISODE)

    const res = await app.inject({
      url: `/api/titles/${SERIES}/progress`,
      cookies: owner,
    })

    expect(res.json().resume).toEqual({
      season: 2,
      episode: 2,
      position: 0,
      duration: null,
      next: true,
      file: { torrentId: 's2', fileIndex: 1 },
    })
  })
})

describe('get /api/titles/:id/up-next', () => {
  function upNext(search: string, id = SERIES) {
    return app.inject({
      url: `/api/titles/${id}/up-next${search}`,
      cookies: owner,
    })
  }

  it('следующая серия с кадром и файлом в этой раздаче', async () => {
    const res = await upNext('?season=2&episode=1&torrentId=s2&language=ru-RU')

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      next: {
        season: 2,
        episode: 2,
        title: 'Эпизод 2',
        file: { torrentId: 's2', fileIndex: 1 },
      },
    })
  })

  it('из другой раздачи файла нет, после последней вышедшей — null', async () => {
    expect((await upNext('?season=1&episode=8&torrentId=s1')).json()).toEqual({
      next: expect.objectContaining({ season: 2, episode: 1, file: null }),
    })
    expect((await upNext('?season=2&episode=4')).json()).toEqual({
      next: null,
    })
  })

  it('фильм — 404, неверный номер — 400', async () => {
    expect((await upNext('?season=1&episode=1', MOVIE)).statusCode).toBe(404)
    expect((await upNext('?season=0&episode=1')).statusCode).toBe(400)
  })
})
