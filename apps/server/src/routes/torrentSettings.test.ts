import type { Torrent } from '../db/schema.ts'
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
import { serverSettings, torrents, users } from '../db/schema.ts'
import { setEngineDown, setEngineReady } from '../services/engine/index.ts'
import {
  INFO_HASH,
  liveState,
  movieDetails,
  sampleTorrentFile,
} from '../services/engine/fixtures/index.ts'
import { enforceSeeding, seedingOf } from '../services/torrents/seeding.ts'
import {
  defaultTorrentSettings,
  engineSettingsArgs,
  getTorrentSettings,
  rememberLaunched,
  resetLaunched,
} from '../services/torrents/settings.ts'
import { signToken } from '../utils/token.ts'

const app = createApp()
const fetchMock = vi.fn<typeof fetch>()
const owner = { [ACCESS_TOKEN_COOKIE]: signToken('owner', 'user_access') }
const HOUR = 60 * 60 * 1000

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
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
      inEngine: true,
      ...values,
    })
    .returning()
    .get()
}

function put(payload: unknown) {
  return app.inject({
    method: 'PUT',
    url: '/api/settings/torrent',
    cookies: owner,
    payload: payload as Record<string, unknown>,
  })
}

const done = {
  ...liveState,
  wantedCompleted: liveState.bytesWanted,
  uploaded: 2 * liveState.bytesWanted,
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
})

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  getDb().delete(serverSettings).run()
  getDb().delete(torrents).run()
  resetLaunched()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  setEngineDown('stopped')
})

describe('настройки торрента', () => {
  it('без сессии аккаунта — 401', async () => {
    expect(
      (await app.inject({ url: '/api/settings/torrent' })).statusCode,
    ).toBe(401)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/settings/torrent/restart',
        })
      ).statusCode,
    ).toBe(401)
  })

  it('умолчания: очередь на 3, 200 соединений, раздача всегда, порт выбран один раз', async () => {
    const first = (
      await app.inject({ url: '/api/settings/torrent', cookies: owner })
    ).json()
    const second = (
      await app.inject({ url: '/api/settings/torrent', cookies: owner })
    ).json()

    expect(first).toMatchObject({
      values: {
        downloadLimit: 0,
        uploadLimit: 0,
        activeDownloads: 3,
        seedRule: { mode: 'always' },
        seedCache: true,
        connsPerTorrent: 50,
        connsTotal: 200,
        upnp: false,
        dht: true,
        pex: true,
        encryption: 'prefer',
      },
      custom: [],
      peerPortEnv: null,
      pendingRestart: [],
      restartBlocked: 'not_running',
      activeStreams: 0,
    })
    expect(first.values.peerPort).toBeGreaterThanOrEqual(49152)
    expect(second.values.peerPort).toBe(first.values.peerPort)
  })

  it('порт из окружения — умолчание', async () => {
    vi.stubEnv('ENGINE_PEER_PORT', '51413')

    const body = (
      await app.inject({ url: '/api/settings/torrent', cookies: owner })
    ).json()

    expect(body.values.peerPort).toBe(51413)
    expect(body.peerPortEnv).toBe(51413)
  })

  it('карточка сохраняет только свои поля', async () => {
    const response = await put({ downloadLimit: 1_048_576 })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      values: { downloadLimit: 1_048_576, activeDownloads: 3 },
      custom: ['downloadLimit'],
    })

    await put({ seedRule: { mode: 'ratio', ratio: 2 } })

    expect(getTorrentSettings()).toMatchObject({
      downloadLimit: 1_048_576,
      seedRule: { mode: 'ratio', ratio: 2 },
    })
  })

  it.each([
    [{}],
    [{ seedRule: { mode: 'ratio' } }],
    [{ seedRule: { mode: 'time' } }],
    [{ peerPort: 80 }],
    [{ connsPerTorrent: 0 }],
    [{ downloadLimit: -1 }],
    [{ encryption: 'off' }],
  ])('неверное тело %j — 400', async (payload) => {
    expect((await put(payload)).statusCode).toBe(400)
  })

  it('живые поля сразу уходят в запущенный движок', async () => {
    setEngineReady('http://127.0.0.1:4000')
    fetchMock.mockImplementation(async (_input, init) =>
      json(JSON.parse(String(init?.body))),
    )

    await put({ uploadLimit: 524_288, activeDownloads: 1 })

    const [input, init] = fetchMock.mock.calls[0]!

    expect(String(input)).toBe('http://127.0.0.1:4000/settings')
    expect(JSON.parse(String(init?.body))).toEqual({
      downloadLimit: 0,
      uploadLimit: 524_288,
      connsPerTorrent: 50,
      connsTotal: 200,
      activeDownloads: 1,
    })
  })

  it('сеть — после перезапуска движка', async () => {
    rememberLaunched(getTorrentSettings())

    const body = (await put({ dht: false, upnp: true })).json()

    expect(body.pendingRestart).toEqual(['upnp', 'dht'])
    expect(fetchMock).not.toHaveBeenCalled()

    // Вернули как было — перезапуск не нужен
    expect(
      (await put({ dht: true, upnp: false })).json().pendingRestart,
    ).toEqual([])
  })

  it('перезапуск без движка — 409 с причиной', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/settings/torrent/restart',
      cookies: owner,
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().reason).toBe('not_running')
  })

  it('флаги запуска движка', () => {
    const args = engineSettingsArgs({
      ...defaultTorrentSettings(),
      peerPort: 50000,
      upnp: true,
      dht: false,
      encryption: 'require',
      downloadLimit: 1000,
    })

    expect(args).toEqual([
      '--peer-port',
      '50000',
      '--encryption',
      'require',
      '--download-limit',
      '1000',
      '--upload-limit',
      '0',
      '--conns-per-torrent',
      '50',
      '--conns-total',
      '200',
      '--active-downloads',
      '3',
      '--upnp',
      '--no-dht',
    ])
  })
})

describe('правило раздачи', () => {
  const settings = () => defaultTorrentSettings()

  it('закреплённая: всегда, до рейтинга, по времени, никогда', () => {
    const keep = insertTorrent({
      retention: 'keep',
      completedAt: new Date(Date.now() - 3 * HOUR),
    })

    expect(seedingOf(keep, done, settings())).toMatchObject({
      seed: true,
      stopped: null,
      ratio: 2,
    })
    expect(
      seedingOf(
        { ...keep, seedRule: { mode: 'ratio', ratio: 2 } },
        done,
        settings(),
      ),
    ).toMatchObject({ seed: false, stopped: 'ratio' })
    expect(
      seedingOf(
        { ...keep, seedRule: { mode: 'ratio', ratio: 3 } },
        done,
        settings(),
      ),
    ).toMatchObject({ seed: true, stopped: null })
    expect(
      seedingOf(
        { ...keep, seedRule: { mode: 'time', minutes: 120 } },
        done,
        settings(),
      ),
    ).toMatchObject({ seed: false, stopped: 'time' })
    expect(
      seedingOf(
        { ...keep, seedRule: { mode: 'time', minutes: 240 } },
        done,
        settings(),
      ),
    ).toMatchObject({ seed: true })
    expect(
      seedingOf({ ...keep, seedRule: { mode: 'never' } }, done, settings()),
    ).toMatchObject({ seed: false, stopped: 'never' })
  })

  it('общее правило действует на загрузки без своего', () => {
    const keep = insertTorrent({ retention: 'keep' })
    const never = { ...settings(), seedRule: { mode: 'never' as const } }

    expect(seedingOf(keep, done, never)).toMatchObject({
      seed: false,
      effective: { mode: 'never' },
      rule: null,
    })
  })

  it('недокачанная: остановки не видно, флаг — по правилу', () => {
    const keep = insertTorrent({
      retention: 'keep',
      seedRule: { mode: 'never' },
    })

    expect(seedingOf(keep, liveState, settings())).toMatchObject({
      seed: false,
      stopped: null,
    })
  })

  it('кэш — переключатель «Раздавать то, что смотрели»', () => {
    const cached = insertTorrent({ retention: 'cache' })

    expect(seedingOf(cached, done, settings())).toMatchObject({
      seed: true,
      effective: null,
    })
    expect(
      seedingOf(cached, done, { ...settings(), seedCache: false }),
    ).toMatchObject({ seed: false, stopped: 'cache' })
  })

  it('отмечает докачанное и шлёт движку флаг только при изменении', async () => {
    const keep = insertTorrent({
      retention: 'keep',
      seedRule: { mode: 'never' },
    })

    setEngineReady('http://127.0.0.1:4000')
    fetchMock.mockImplementation(
      async () => new Response(null, { status: 204 }),
    )

    const live = new Map([[INFO_HASH, done]])

    await enforceSeeding(live)
    await enforceSeeding(live)

    const calls = fetchMock.mock.calls.map(([input, init]) => [
      String(input),
      init?.body,
    ])

    expect(calls).toEqual([
      [`http://127.0.0.1:4000/torrents/${INFO_HASH}/seed`, '{"seed":false}'],
    ])

    const row = getDb()
      .select()
      .from(torrents)
      .all()
      .find(item => item.id === keep.id)

    expect(row?.completedAt).toBeInstanceOf(Date)
  })

  it('своё правило в карточке загрузки — только у закреплённых', async () => {
    const cached = insertTorrent({ retention: 'cache' })

    const refused = await app.inject({
      method: 'PUT',
      url: `/api/torrents/${cached.id}/seeding`,
      cookies: owner,
      payload: { rule: { mode: 'never' } },
    })

    expect(refused.statusCode).toBe(409)

    getDb().delete(torrents).run()
    const keep = insertTorrent({ retention: 'keep' })

    const saved = await app.inject({
      method: 'PUT',
      url: `/api/torrents/${keep.id}/seeding`,
      cookies: owner,
      payload: { rule: { mode: 'time', minutes: 1440 } },
    })

    expect(saved.statusCode).toBe(200)
    expect(saved.json().seeding).toMatchObject({
      rule: { mode: 'time', minutes: 1440 },
      effective: { mode: 'time', minutes: 1440 },
    })
  })
})
