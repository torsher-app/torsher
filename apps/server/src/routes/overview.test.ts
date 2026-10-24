import type { Language } from '@torsher/i18n'
import { Buffer } from 'node:buffer'
import { attentionMessage, messages } from '@torsher/i18n'
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
import { attentionKinds } from '../dto/overview.ts'
import { ACCESS_TOKEN_COOKIE, DEVICE_TOKEN_COOKIE } from '../config.ts'
import { getDb, migrateDb } from '../db/index.ts'
import {
  devices,
  indexers,
  serverSettings,
  storagePolicy,
  torrents,
} from '../db/schema.ts'
import {
  backupProblems,
  saveBackupSettings,
} from '../services/backups/index.ts'
import { updateBackupState } from '../services/backups/state.ts'
import { setEngineDown, setEngineReady } from '../services/engine/index.ts'
import { accelDeps, mediaAccel, resetAccel } from '../services/media/accel.ts'
import {
  INFO_HASH,
  liveState,
  sampleTorrentFile,
} from '../services/engine/fixtures/index.ts'
import { checkDeps, waitForCheck } from '../services/net/check.ts'
import { routesChanged } from '../services/net/index.ts'
import { saveTmdbKey } from '../services/tmdb/credentials.ts'
import { createOwner } from '../services/users/index.ts'
import { signToken } from '../utils/token.ts'

const GIB = 1024 ** 3
const ENGINE = 'http://127.0.0.1:4000'
const disk = vi.hoisted(() => ({ total: 0, free: 0 }))

vi.mock('../services/storage/disk.ts', () => ({
  diskUsage: async () => ({ ...disk }),
}))

// Счётчик падений ведёт супервизор процесса, которого в тестах нет
const engineCrashes = vi.hoisted(() => ({ count: 0 }))

vi.mock('../services/engine/index.ts', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/engine/index.ts')>()),
  engineCrashCount: () => engineCrashes.count,
}))

const app = createApp()
const fetchMock = vi.fn<typeof fetch>()
let owner: Record<string, string>
let device: Record<string, string>
let live: (typeof liveState)[] = []
// Ответ внешнего хоста (TMDB, индексатор); движок отвечает списком `live`
let external: (url: URL) => Promise<Response> = async () =>
  new Response('{}', { status: 200 })

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function failure(code: string) {
  return new TypeError('fetch failed', {
    cause: Object.assign(new Error(code), { code }),
  })
}

async function overview() {
  const res = await app.inject({ url: '/api/overview', cookies: owner })

  expect(res.statusCode).toBe(200)

  return res.json()
}

function insertIndexer(values: Partial<typeof indexers.$inferInsert>) {
  getDb()
    .insert(indexers)
    .values({
      name: 'Indexer',
      url: 'http://indexer.example/torznab',
      ...values,
    })
    .run()
}

function insertTorrent(values: Partial<typeof torrents.$inferInsert> = {}) {
  getDb()
    .insert(torrents)
    .values({
      infoHash: INFO_HASH,
      name: 'Sample Movie (2008)',
      source: 'file',
      torrentFile: Buffer.from(sampleTorrentFile()),
      files: [],
      pieceLength: 262_144,
      status: 'ready',
      inEngine: true,
      ...values,
    })
    .run()
}

beforeAll(async () => {
  await migrateDb()

  const user = createOwner({
    name: 'Owner',
    email: 'owner@example.com',
    passwordHash: 'x',
  })

  owner = { [ACCESS_TOKEN_COOKIE]: signToken(user.id, 'user_access') }

  // Устройство — настоящим циклом кода, как у телевизора
  const started = await app.inject({
    method: 'POST',
    url: '/api/devices/pairing',
    payload: {},
  })

  await app.inject({
    method: 'POST',
    url: '/api/devices/pairing/confirm',
    cookies: owner,
    payload: { code: started.json().code, name: 'TV' },
  })

  const approved = await app.inject({
    url: `/api/devices/pairing/${started.json().secret}`,
  })
  const cookie = approved.cookies.find(
    item => item.name === DEVICE_TOKEN_COOKIE,
  )

  device = { [DEVICE_TOKEN_COOKIE]: cookie!.value }
})

beforeEach(() => {
  for (const name of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'])
    vi.stubEnv(name, '')
  vi.stubEnv('TMDB_ACCESS_TOKEN', 'app-token')
  disk.total = 1000 * GIB
  disk.free = 500 * GIB
  live = []
  external = async () => json({})
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input) => {
    const url = new URL(String(input))

    return url.origin === ENGINE ? json(live) : external(url)
  })
  vi.stubGlobal('fetch', fetchMock)
  setEngineReady(ENGINE)
  engineCrashes.count = 0
  getDb().delete(torrents).run()
  getDb().delete(indexers).run()
  getDb().delete(storagePolicy).run()
  getDb().delete(serverSettings).run()
  getDb().update(devices).set({ lastStreamAt: null }).run()
  saveTmdbKey(null)
  routesChanged()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  setEngineDown('stopped')
})

describe('доступ', () => {
  it('без входа — 401', async () => {
    const res = await app.inject({ url: '/api/overview' })

    expect(res.statusCode).toBe(401)
  })

  it('токен устройства панель не открывает', async () => {
    const res = await app.inject({ url: '/api/overview', cookies: device })

    expect(res.statusCode).toBe(401)
  })
})

describe('обзор', () => {
  it('пустой сервер: проблем нет, плитки с нулями', async () => {
    const body = await overview()

    expect(body).toEqual({
      startedAt: expect.any(String),
      version: expect.stringMatching(/^\d+\.\d+\.\d+/),
      attention: [],
      downloads: { total: 0, active: 0, downloadSpeed: 0, uploadSpeed: 0 },
      storage: {
        usedByCache: 0,
        cacheLimit: 200 * GIB,
        free: 500 * GIB,
        total: 1000 * GIB,
        minFree: 20 * GIB,
      },
      sources: { ok: 0, total: 0 },
      devices: { total: 1, watching: 0 },
      playback: null,
      backups: { enabled: true, failing: false },
    })
    expect(Date.parse(body.startedAt)).toBeLessThanOrEqual(Date.now())
  })

  it('плитки: загрузки, кэш, индексаторы и «смотрит сейчас»', async () => {
    insertTorrent()
    live = [{ ...liveState }]
    insertIndexer({ name: 'A', checkStatus: 'ok' })
    insertIndexer({ name: 'B', checkStatus: 'ok', enabled: false })
    insertIndexer({ name: 'C', checkStatus: 'timeout' })
    getDb().update(devices).set({ lastStreamAt: new Date() }).run()

    const body = await overview()

    expect(body.downloads).toEqual({
      total: 1,
      active: 1,
      downloadSpeed: liveState.downloadSpeed,
      uploadSpeed: liveState.uploadSpeed,
    })
    expect(body.storage.usedByCache).toBe(liveState.bytesCompleted)
    expect(body.sources).toEqual({ ok: 1, total: 2 })
    expect(body.devices).toEqual({ total: 1, watching: 1 })
  })

  it('движок не запущен: engine_down, цифры загрузок — нули', async () => {
    insertTorrent()
    setEngineDown('not_installed')

    const body = await overview()

    expect(body.attention).toEqual([
      {
        kind: 'engine_down',
        severity: 'error',
        section: 'downloads',
        params: { reason: 'not_installed' },
      },
    ])
    expect(body.downloads).toMatchObject({ total: 1, active: 0 })
  })

  it('движок запускается — только предупреждение', async () => {
    setEngineDown('starting')

    const [item] = (await overview()).attention

    expect(item).toMatchObject({ kind: 'engine_down', severity: 'warning' })
  })

  it('мало места и пауза из-за места', async () => {
    disk.free = 10 * GIB
    insertTorrent({ pauseReason: 'storage' })
    live = [{ ...liveState, paused: true }]

    const body = await overview()

    expect(body.attention).toEqual([
      {
        kind: 'storage_low',
        severity: 'error',
        section: 'storage',
        params: { free: 10 * GIB, minFree: 20 * GIB },
      },
      {
        kind: 'storage_paused',
        severity: 'warning',
        section: 'storage',
        params: { count: 1, name: 'Sample Movie (2008)' },
      },
    ])
  })

  it('индексаторы: ошибка важнее пропажи, выключенные не считаются', async () => {
    insertIndexer({ name: 'Broken', checkStatus: 'auth', missing: true })
    insertIndexer({ name: 'Gone 1', checkStatus: 'ok', missing: true })
    insertIndexer({ name: 'Gone 2', missing: true })
    insertIndexer({ name: 'Off', checkStatus: 'auth', enabled: false })

    const body = await overview()

    expect(body.attention).toEqual([
      {
        kind: 'indexer_error',
        severity: 'error',
        section: 'sources',
        params: { count: 1, name: 'Broken' },
      },
      {
        kind: 'indexer_missing',
        severity: 'warning',
        section: 'sources',
        params: { count: 2 },
      },
    ])
  })

  it('ключа TMDB нет', async () => {
    vi.stubEnv('TMDB_ACCESS_TOKEN', '')

    expect((await overview()).attention).toEqual([
      {
        kind: 'tmdb_key_invalid',
        severity: 'error',
        section: 'metadata',
        params: { reason: 'missing' },
      },
    ])
  })

  it('tMDB не принял ключ сервера, пока следующий ответ не успешен', async () => {
    external = async () => json({ status_message: 'Invalid API key' }, 401)
    await app.inject({
      method: 'POST',
      url: '/api/settings/metadata/check',
      cookies: owner,
      payload: {},
    })

    expect((await overview()).attention).toEqual([
      expect.objectContaining({
        kind: 'tmdb_key_invalid',
        params: { reason: 'rejected' },
      }),
    ])

    // Проверка чужого ключа признак ключа сервера не меняет
    external = async () => json({})
    await app.inject({
      method: 'POST',
      url: '/api/settings/metadata/check',
      cookies: owner,
      payload: { tmdbKey: 'other-key' },
    })
    expect((await overview()).attention).toHaveLength(1)

    await app.inject({
      method: 'POST',
      url: '/api/settings/metadata/check',
      cookies: owner,
      payload: {},
    })
    expect((await overview()).attention).toEqual([])
  })

  it('движок не падал — пункта о падениях нет', async () => {
    expect((await overview()).attention).toEqual([])
  })

  it('движок падал и поднялся — предупреждение со ссылкой в журнал', async () => {
    engineCrashes.count = 3

    expect((await overview()).attention).toEqual([
      {
        kind: 'engine_crashed',
        severity: 'warning',
        section: 'logs',
        params: { count: 3 },
      },
    ])
  })

  it('движок падал и не поднялся — ошибка рядом с engine_down', async () => {
    engineCrashes.count = 2
    setEngineDown('stopped')

    expect((await overview()).attention).toEqual([
      {
        kind: 'engine_down',
        severity: 'error',
        section: 'downloads',
        params: { reason: 'stopped' },
      },
      {
        kind: 'engine_crashed',
        severity: 'error',
        section: 'logs',
        params: { count: 2 },
      },
    ])
  })

  it('порядок: ошибки раньше предупреждений', async () => {
    setEngineDown('starting')
    vi.stubEnv('TMDB_ACCESS_TOKEN', '')

    const kinds = (await overview()).attention.map(
      (item: { kind: string }) => item.kind,
    )

    expect(kinds).toEqual(['tmdb_key_invalid', 'engine_down'])
  })

  it('копии: каталог недоступен — одна строка, без повтора сбоя и давности', async () => {
    updateBackupState({
      dirAvailable: false,
      lastAttempt: {
        at: new Date().toISOString(),
        slot: new Date().toISOString(),
        count: 1,
        error: { kind: 'dir_unavailable', params: { path: '/mnt/nas' } },
      },
    })

    const body = await overview()

    expect(body.attention).toEqual([
      {
        kind: 'backup_dir_unavailable',
        severity: 'error',
        section: 'backups',
        params: {},
      },
    ])
    expect(body.backups).toEqual({ enabled: true, failing: true })
  })

  it('копии: нет места — сбой с цифрами; удачная копия после сбоя его снимает', async () => {
    const failedAt = new Date(Date.now() - 60_000).toISOString()

    updateBackupState({
      lastAttempt: {
        at: failedAt,
        slot: failedAt,
        count: 1,
        error: { kind: 'no_space', params: { need: 3 * GIB, free: GIB } },
      },
    })

    expect((await overview()).attention).toEqual([
      {
        kind: 'backup_failed',
        severity: 'error',
        section: 'backups',
        params: { reason: 'no_space', need: 3 * GIB, free: GIB },
      },
    ])

    const okAt = new Date().toISOString()

    updateBackupState({ lastSuccessAt: okAt })

    const body = await overview()

    expect(body.attention).toEqual([])
    expect(body.backups).toEqual({
      enabled: true,
      lastSuccessAt: okAt,
      failing: false,
    })
  })

  it('копии: давность — от начала наблюдения, включение копий начинает его заново', () => {
    const threeDaysAgo = new Date(Date.now() - 72 * 60 * 60 * 1000)

    updateBackupState({ watchSince: threeDaysAgo.toISOString() })
    expect(backupProblems().failed).toEqual({ kind: 'stale', params: {} })

    saveBackupSettings({ enabled: false })
    saveBackupSettings({ enabled: true })
    expect(backupProblems().failed).toBeUndefined()
  })

  it('копии: «снимок уже идёт» — не сбой', () => {
    const at = new Date().toISOString()

    updateBackupState({
      lastAttempt: {
        at,
        slot: at,
        count: 1,
        error: { kind: 'busy', params: {} },
      },
    })
    expect(backupProblems().failed).toBeUndefined()
  })

  it('копии: двое суток без удачной — stale, выключенные не тревожат', () => {
    const later = new Date(Date.now() + 49 * 60 * 60 * 1000)

    expect(backupProblems(later).failed).toEqual({
      kind: 'stale',
      params: {},
    })
    saveBackupSettings({ enabled: false })
    expect(backupProblems(later)).toEqual({
      dirUnavailable: false,
      failed: undefined,
    })
  })

  it('ускорение: плитка после проверки, видеокарта не прошла проверку', async () => {
    let gpuWorks = false

    vi.spyOn(accelDeps, 'list').mockImplementation(async kind =>
      kind === '-encoders'
        ? ' V....D libx264  H.264\n V....D h264_vaapi  VAAPI'
        : '',
    )
    vi.spyOn(accelDeps, 'renderNodes').mockResolvedValue([
      '/dev/dri/renderD128',
    ])
    vi.spyOn(accelDeps, 'nvidiaDevices').mockResolvedValue([])
    vi.spyOn(accelDeps, 'run').mockImplementation(async (args) => {
      const ok = !args.includes('h264_vaapi') || gpuWorks

      return {
        code: ok ? 0 : 1,
        stderr: ok ? '' : 'Failed to initialise VAAPI connection: -1',
        ms: 500,
      }
    })

    try {
      await mediaAccel()

      const failed = await overview()

      expect(failed.playback).toMatchObject({
        accel: 'auto',
        encoder: 'software',
        failed: [{ encoder: 'vaapi', device: '/dev/dri/renderD128' }],
      })
      expect(failed.attention).toEqual([
        {
          kind: 'media_accel_failed',
          severity: 'warning',
          section: 'playback',
          params: {},
        },
      ])

      gpuWorks = true
      resetAccel()
      await mediaAccel()

      const working = await overview()

      expect(working.playback).toMatchObject({ encoder: 'vaapi', failed: [] })
      expect(working.attention).toEqual([])
    }
    finally {
      resetAccel()
    }
  })

  // Результаты проверки хостов живут в памяти процесса: этот тест последний
  it('хосты: берёт последний результат проверки, подмена DNS — отдельно', async () => {
    insertIndexer({
      name: 'Local',
      url: 'http://indexer.example:9117/torznab',
    })

    // До проверки сети знать нечего
    expect((await overview()).attention).toEqual([])

    vi.spyOn(checkDeps, 'systemAddresses').mockImplementation(async host =>
      host === 'api.themoviedb.org' ? ['10.10.10.10'] : ['203.0.113.1'],
    )
    vi.spyOn(checkDeps, 'dohAddresses').mockResolvedValue(['203.0.113.1'])
    external = async (url) => {
      if (url.hostname === 'image.tmdb.org')
        return new Response('')

      throw failure(
        url.hostname === 'api.themoviedb.org'
          ? 'ERR_TLS_CERT_ALTNAME_INVALID'
          : 'ECONNREFUSED',
      )
    }

    await app.inject({
      method: 'POST',
      url: '/api/net/check',
      cookies: owner,
      payload: {},
    })
    await waitForCheck()

    const before = fetchMock.mock.calls.length
    const body = await overview()

    expect(body.attention).toEqual([
      {
        kind: 'dns_spoofing',
        severity: 'error',
        section: 'network',
        params: { count: 1, name: 'api.themoviedb.org' },
      },
      {
        kind: 'host_unreachable',
        severity: 'error',
        section: 'network',
        params: { count: 1, name: 'indexer.example:9117' },
      },
    ])
    // Обзор проверку не запускает: наружу запросов нет, только движок
    const calls = fetchMock.mock.calls.slice(before)

    expect(calls.every(([input]) => String(input).startsWith(ENGINE))).toBe(
      true,
    )
  })
})

describe('тексты «Требует внимания»', () => {
  type Params = Parameters<typeof attentionMessage>[0]['params']

  // Проблемы, у которых своя строка на причину
  const variants: Partial<Record<(typeof attentionKinds)[number], Params[]>> = {
    engine_down: ['not_installed', 'starting', 'stopped'].map(reason => ({
      reason,
    })),
    tmdb_key_invalid: ['missing', 'unreadable', 'rejected'].map(reason => ({
      reason,
    })),
    backup_failed: [
      { reason: 'no_space', need: 2, free: 1 },
      ...[
        'no_space',
        'io',
        'integrity',
        'key_unavailable',
        'dir_unavailable',
        'stale',
      ].map(reason => ({ reason })),
    ],
  }

  function lookup(language: Language, key: string) {
    let node: unknown = messages[language]

    for (const part of key.split('.'))
      node = (node as Record<string, unknown> | undefined)?.[part]

    return node
  }

  it.each(Object.keys(messages) as Language[])(
    'у каждого вида проблемы есть строка (%s)',
    (language) => {
      for (const kind of attentionKinds) {
        const list = variants[kind] ?? [{ name: 'x', count: 1 }, { count: 2 }]

        for (const params of list) {
          const { key } = attentionMessage({ kind, params })

          expect(typeof lookup(language, key), `${kind} ${key}`).toBe('string')
        }
      }
    },
  )
})
