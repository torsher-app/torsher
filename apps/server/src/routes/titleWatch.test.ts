import { Buffer } from 'node:buffer'
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
  indexers,
  titleProgress,
  titleVoices,
  torrents,
  users,
} from '../db/schema.ts'
import { setEngineDown, setEngineReady } from '../services/engine/index.ts'
import {
  engineError,
  sampleTorrentFile,
} from '../services/engine/fixtures/index.ts'
import { clearSearchCache } from '../services/sources/cache.ts'
import { tvIdentity } from '../services/tmdb/fixtures/index.ts'
import { searchXml } from '../services/torznab/fixtures/index.ts'
import { signToken } from '../utils/token.ts'

// Место на диске для проверки перед просмотром — с запасом
vi.mock('../services/storage/disk.ts', () => ({
  diskUsage: async () => ({ total: 1024 ** 4, free: 512 * 1024 ** 3 }),
}))

const app = createApp()
const fetchMock = vi.fn<typeof fetch>()
const owner = { [ACCESS_TOKEN_COOKIE]: signToken('owner', 'user_access') }
const TITLE = 'tmdb:tv:101'
const GB = 1024 ** 3

// Пак второго сезона с раздачи из searchXml: восемь серий и сэмпл
const packDetails = {
  infoHash: '1'.repeat(40),
  name: 'Quiet.Harbor.S02.1080p.WEB-DL',
  pieceLength: 4_194_304,
  pieceCount: 3840,
  files: [
    {
      path: 'Quiet.Harbor.S02/Sample/sample.mkv',
      length: 50_000_000,
      padding: false,
    },
    ...Array.from({ length: 8 }, (_, i) => ({
      path: `Quiet.Harbor.S02/Quiet.Harbor.S02E0${i + 1}.1080p.WEB-DL.mkv`,
      length: 2 * GB,
      padding: false,
    })),
  ],
}

type Route = (url: URL, init: RequestInit) => Response | Promise<Response>

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

let overrides: Record<string, Route> = {}

function routeOf(url: URL, method: string): Route | undefined {
  const key = `${method} ${url.host}${url.pathname}`

  if (overrides[key])
    return overrides[key]

  if (url.hostname === 'api.themoviedb.org')
    return () => json(tvIdentity)

  if (key === 'GET a.indexer.example/torznab/api')
    return () => new Response(searchXml)

  if (key === 'GET indexer.example/download/101')
    return () => new Response(sampleTorrentFile())

  if (
    key === 'POST 127.0.0.1:4000/torrents/inspect'
    || key === 'POST 127.0.0.1:4000/torrents'
  ) {
    return () => json(packDetails)
  }

  // Список раздач движка читает проверка места перед просмотром
  if (key === 'GET 127.0.0.1:4000/torrents')
    return () => json([])

  return undefined
}

beforeAll(async () => {
  await migrateDb()
  // Сессию проверяют по аккаунту в базе (версия сессий)
  getDb()
    .insert(users)
    .values({
      id: 'owner',
      name: 'Owner',
      email: 'owner@example.com',
      passwordHash: 'hash',
    })
    .run()
  getDb()
    .insert(indexers)
    .values({
      name: 'Indexer A',
      url: 'https://a.indexer.example/torznab',
      caps: {
        search: { available: true, params: ['q'] },
        tvSearch: { available: true, params: ['q', 'season', 'tvdbid'] },
        movieSearch: { available: false, params: [] },
        categories: [],
      },
    })
    .run()
})

beforeEach(() => {
  clearSearchCache()
  overrides = {}
  getDb().delete(torrents).run()
  getDb().delete(titleProgress).run()
  getDb().delete(titleVoices).run()
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input, init = {}) => {
    const url = new URL(String(input))
    const route = routeOf(url, init.method ?? 'GET')

    return route
      ? route(url, init)
      : json(engineError('torrent_not_found', 'not found'), 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('TMDB_ACCESS_TOKEN', 'test-token')
  setEngineReady('http://127.0.0.1:4000')
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  setEngineDown('stopped')
})

/** Проматывает фальшивое время, пока промис не выполнится */
async function settle<T>(promise: Promise<T>) {
  const state = { done: false }

  void promise.finally(() => {
    state.done = true
  })

  while (!state.done) await vi.advanceTimersByTimeAsync(500)

  return promise
}

function watch(payload: object) {
  return app.inject({
    method: 'POST',
    url: `/api/titles/${TITLE}/watch`,
    cookies: owner,
    payload,
  })
}

describe('post /api/titles/:id/watch', () => {
  it('отвечает 401 без входа', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/titles/${TITLE}/watch`,
      payload: {},
    })

    expect(res.statusCode).toBe(401)
  })

  it('берёт лучший кандидат, добавляет раздачу и выбирает файл серии', async () => {
    const res = await watch({ season: 2, episode: 5 })
    const body = res.json()
    const torrent = getDb().select().from(torrents).get()

    expect(res.statusCode).toBe(200)
    expect(body).toMatchObject({ status: 'ready', fileIndex: 5 })
    expect(torrent).toMatchObject({
      id: body.torrentId,
      status: 'ready',
      titleId: TITLE,
    })
    expect(torrent!.files![5]!.path).toContain('S02E05')
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).startsWith('https://indexer.example/download/101'),
      ),
    ).toBe(true)
  })

  it('озвучка выбранной раздачи становится «как в прошлых сериях»', async () => {
    await watch({ season: 2, episode: 5 })

    const res = await app.inject({
      url: `/api/titles/${TITLE}/sources?season=2&episode=6`,
      cookies: owner,
    })

    expect(res.json().pinnedVoice).toEqual({ studio: 'LostFilm' })
    expect(res.json().candidates[0].pickReason).toBe('pinnedVoice')
  })

  it('раздача сезона: в прогрессе с сериями, в источниках — помеченный кандидат', async () => {
    const first = (await watch({ season: 2, episode: 5 })).json()

    const progress = await app.inject({
      url: `/api/titles/${TITLE}/progress`,
      cookies: owner,
    })

    expect(progress.json().seasonReleases).toEqual([
      {
        season: 2,
        torrentId: first.torrentId,
        quality: '1080p',
        voice: expect.objectContaining({ studio: 'LostFilm' }),
        episodes: [1, 2, 3, 4, 5, 6, 7, 8],
      },
    ])

    const sources = await app.inject({
      url: `/api/titles/${TITLE}/sources?season=2&episode=6`,
      cookies: owner,
    })

    expect(sources.json().seasonCandidate).toBe(first.candidateId)
  })

  it('серия из раздачи сезона по torrentId — без поиска по индексаторам', async () => {
    const first = (await watch({ season: 2, episode: 5 })).json()

    fetchMock.mockClear()

    const next = await watch({
      season: 2,
      episode: 6,
      torrentId: first.torrentId,
    })

    expect(next.statusCode).toBe(200)
    expect(next.json()).toMatchObject({
      status: 'ready',
      torrentId: first.torrentId,
      fileIndex: 6,
    })
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).startsWith('https://indexer.example'),
      ),
    ).toBe(false)

    const missing = await watch({
      season: 2,
      episode: 9,
      torrentId: first.torrentId,
    })

    expect(missing.statusCode).toBe(422)
    expect(missing.json().kind).toBe('not_playable')
  })

  it('серии нет ни в одной раздаче — 422 no_sources', async () => {
    const res = await watch({ season: 2, episode: 9 })

    expect(res.statusCode).toBe(422)
    expect(res.json().kind).toBe('no_sources')
  })

  it('раздача не скачалась и замены нет — 422 not_playable', async () => {
    overrides['GET indexer.example/download/101'] = () =>
      new Response('Forbidden', { status: 403 })

    const res = await watch({ season: 2, episode: 5 })

    expect(res.statusCode).toBe(422)
    expect(res.json().kind).toBe('not_playable')
  })

  it('в раздаче нет файла серии — 422 not_playable', async () => {
    overrides['POST 127.0.0.1:4000/torrents/inspect'] = () =>
      json({ ...packDetails, files: packDetails.files.slice(0, 3) })

    const res = await watch({ season: 2, episode: 5 })

    expect(res.statusCode).toBe(422)
    expect(res.json().kind).toBe('not_playable')
  })

  it('раздача из листа по magnet ждёт метаданные — 202', async () => {
    overrides['POST 127.0.0.1:4000/torrents/resolve'] = () =>
      new Promise<Response>(() => {})

    const sources = await app.inject({
      url: `/api/titles/${TITLE}/sources?season=2&episode=5`,
      cookies: owner,
    })
    const magnetOnly = sources
      .json()
      .candidates
      .find((item: { quality: string }) => item.quality === '2160p')

    vi.useFakeTimers({ toFake: ['setTimeout'] })

    const res = await settle(
      watch({ season: 2, episode: 5, candidateId: magnetOnly.id }),
    )

    expect(res.statusCode).toBe(202)
    expect(res.json()).toMatchObject({
      status: 'resolving',
      fileIndex: null,
      candidateId: magnetOnly.id,
    })
  })

  it('неизвестный кандидат — 422 candidate_gone', async () => {
    const res = await watch({ season: 2, episode: 5, candidateId: 'gone' })

    expect(res.statusCode).toBe(422)
    expect(res.json().kind).toBe('candidate_gone')
  })

  it('без движка — 503', async () => {
    setEngineDown('not_installed')

    const res = await watch({ season: 2, episode: 5 })

    expect(res.statusCode).toBe(503)
    expect(res.json().kind).toBe('not_installed')
  })
})

describe('экран «Источники» и «Файлы»', () => {
  it('open находит кандидата в поиске по строке зрителя', async () => {
    const query = encodeURIComponent('Quiet Harbor')
    const list = await app.inject({
      url: `/api/titles/${TITLE}/sources?all=1&query=${query}`,
      cookies: owner,
    })

    expect(list.statusCode).toBe(200)
    expect(list.json().query.current).toBe('Quiet Harbor')

    const open = await app.inject({
      method: 'POST',
      url: `/api/titles/${TITLE}/open`,
      cookies: owner,
      payload: {
        candidateId: list.json().candidates[0].id,
        query: 'Quiet Harbor',
      },
    })

    expect(open.statusCode).toBe(200)
  })

  it('все сезоны, open без выбора файла, файлы серий и метка последнего просмотра', async () => {
    const list = await app.inject({
      url: `/api/titles/${TITLE}/sources?all=1`,
      cookies: owner,
    })

    expect(list.statusCode).toBe(200)
    expect(list.json().season).toBeNull()

    const pack = list
      .json()
      .candidates
      .find((item: { seasons: number[] }) =>
        item.seasons.includes(2),
      )

    expect(pack.lastWatched).toBe(false)

    const open = await app.inject({
      method: 'POST',
      url: `/api/titles/${TITLE}/open`,
      cookies: owner,
      payload: { candidateId: pack.id },
    })

    expect(open.statusCode).toBe(200)
    expect(open.json().status).toBe('ready')

    const files = await app.inject({
      url: `/api/titles/${TITLE}/files/${open.json().torrentId}`,
      cookies: owner,
    })

    expect(files.statusCode).toBe(200)
    // Сэмпл не серия: в «Файлах» только восемь серий по порядку
    expect(
      files
        .json()
        .files.map((file: { season: number, episode: number }) => [
          file.season,
          file.episode,
        ]),
    ).toEqual(Array.from({ length: 8 }, (_, i) => [2, i + 1]))

    const lastWatchedOf = async () =>
      (
        await app.inject({
          url: `/api/titles/${TITLE}/sources?all=1`,
          cookies: owner,
        })
      )
        .json()
        .candidates
        .find((item: { id: string }) => item.id === pack.id)
        .lastWatched

    // Только открыли — ещё не смотрели
    expect(await lastWatchedOf()).toBe(false)

    await app.inject({
      method: 'PUT',
      url: '/api/watch-state',
      cookies: owner,
      payload: {
        torrentId: open.json().torrentId,
        fileIndex: files.json().files[0].fileIndex,
        position: 600,
        duration: 2700,
        title: { id: TITLE, season: 2, episode: 1 },
      },
    })

    expect(await lastWatchedOf()).toBe(true)
  })

  it('файлы чужой раздачи — 404', async () => {
    const res = await app.inject({
      url: `/api/titles/${TITLE}/files/unknown`,
      cookies: owner,
    })

    expect(res.statusCode).toBe(404)
  })

  it('отметка «просмотрено» с карточки видна в прогрессе по сериям', async () => {
    const mark = (watched: boolean) =>
      app.inject({
        method: 'PUT',
        url: `/api/titles/${TITLE}/watched`,
        cookies: owner,
        payload: { season: 2, episode: 3, watched },
      })

    expect((await mark(true)).statusCode).toBe(200)

    const progress = await app.inject({
      url: `/api/titles/${TITLE}/progress`,
      cookies: owner,
    })

    expect(progress.json().episodes).toContainEqual(
      expect.objectContaining({ season: 2, episode: 3, watched: true }),
    )
    // История — только то, что смотрели в плеере
    expect(progress.json().last).not.toEqual(
      expect.objectContaining({ season: 2, episode: 3 }),
    )

    await mark(false)

    const cleared = await app.inject({
      url: `/api/titles/${TITLE}/progress`,
      cookies: owner,
    })

    expect(cleared.json().episodes).toContainEqual(
      expect.objectContaining({ season: 2, episode: 3, watched: false }),
    )
  })
})

describe('позиция по серии', () => {
  it('сохраняется по тайтлу и переживает смену раздачи', async () => {
    const first = (await watch({ season: 2, episode: 5 })).json()
    const title = { id: TITLE, season: 2, episode: 5 }

    const saved = await app.inject({
      method: 'PUT',
      url: '/api/watch-state',
      cookies: owner,
      payload: {
        torrentId: first.torrentId,
        fileIndex: first.fileIndex,
        position: 600,
        duration: 2700,
        title,
      },
    })

    expect(saved.statusCode).toBe(200)

    const progress = await app.inject({
      url: `/api/titles/${TITLE}/progress`,
      cookies: owner,
    })

    expect(progress.json().last).toMatchObject({
      season: 2,
      episode: 5,
      position: 600,
      duration: 2700,
      watched: false,
    })

    // Другая раздача той же серии: позиция берётся из прогресса серии
    const other = getDb()
      .insert(torrents)
      .values({
        infoHash: '4'.repeat(40),
        name: 'Quiet Harbor S02E05 720p',
        source: 'file',
        torrentFile: Buffer.from(sampleTorrentFile()),
        files: [
          { path: 'Quiet.Harbor.S02E05.720p.mkv', size: GB, padding: false },
        ],
        pieceLength: 262_144,
        status: 'ready',
      })
      .returning()
      .get()
    const playback = await app.inject({
      method: 'POST',
      url: '/api/playback',
      cookies: owner,
      payload: { torrentId: other.id, fileIndex: 0, title },
    })

    expect(playback.statusCode).toBe(200)
    expect(playback.json()).toMatchObject({
      startPosition: 600,
      duration: 2700,
    })
  })

  it('без начатых серий прогресса нет; чужой ID — 404', async () => {
    const empty = await app.inject({
      url: `/api/titles/${TITLE}/progress`,
      cookies: owner,
    })
    const unknown = await app.inject({
      url: '/api/titles/unknown/progress',
      cookies: owner,
    })

    expect(empty.json()).toEqual({
      resume: null,
      last: null,
      seasonReleases: [],
      episodes: [],
    })
    expect(unknown.statusCode).toBe(404)
  })
})

describe('«Скачать сезон» с карточки', () => {
  function download(payload: object) {
    return app.inject({
      method: 'POST',
      url: `/api/titles/${TITLE}/download`,
      cookies: owner,
      payload,
    })
  }

  it('лучшая раздача сезона: качаются серии сезона без сэмпла, раздача закреплена', async () => {
    const res = await download({ season: 2 })
    const torrent = getDb().select().from(torrents).get()
    const added = fetchMock.mock.calls
      .map(([input, init]) => `${init?.method ?? 'GET'} ${String(input)}`)
      .find(call => call.startsWith('POST http://127.0.0.1:4000/torrents?'))

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      status: 'started',
      torrentId: torrent?.id,
      files: 8,
      bytes: 16 * GB,
    })
    expect(added).toBe(
      'POST http://127.0.0.1:4000/torrents?files=1,2,3,4,5,6,7,8',
    )
    expect(torrent).toMatchObject({
      titleId: TITLE,
      retention: 'keep',
      selectedFiles: [1, 2, 3, 4, 5, 6, 7, 8],
    })
  })

  it('сезона нет ни в одной раздаче — 422 no_sources', async () => {
    const res = await download({ season: 9 })

    expect(res.statusCode).toBe(422)
    expect(res.json()).toMatchObject({ kind: 'no_sources' })
  })

  it('выбранные файлы чужой раздачи — 404, без файлов — 400', async () => {
    const other = getDb()
      .insert(torrents)
      .values({
        infoHash: '2'.repeat(40),
        name: 'Other',
        source: 'file',
        files: [{ path: 'a.mkv', size: GB, padding: false }],
        status: 'ready',
        titleId: 'tmdb:tv:999',
      })
      .returning()
      .get()

    expect(
      (await download({ torrentId: other.id, files: [0] })).statusCode,
    ).toBe(404)
    expect((await download({ torrentId: other.id })).statusCode).toBe(400)
  })
})
