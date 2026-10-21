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

  return undefined
}

beforeAll(() => {
  migrateDb()
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
    expect(torrent).toMatchObject({ id: body.torrentId, status: 'ready' })
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

    expect(empty.json()).toEqual({ last: null })
    expect(unknown.statusCode).toBe(404)
  })
})
