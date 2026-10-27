import type { AttentionItem } from '../../dto/overview.ts'
import type { EngineTorrentState } from '../engine/index.ts'
import type { ChannelInput } from './channels/store.ts'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { createApp } from '../../app.ts'
import { ACCESS_TOKEN_COOKIE } from '../../config.ts'
import { getDb, migrateDb } from '../../db/index.ts'
import {
  indexers,
  notificationChannels,
  notifications,
  torrents,
} from '../../db/schema.ts'
import { createOwner } from '../users/index.ts'
import { signToken } from '../../utils/token.ts'
import { liveState as fixtureState } from '../engine/fixtures/index.ts'
import { logFor } from '../logs/index.ts'
import { checkDeps, checkState, startCheck } from '../net/check.ts'
import { capsXml } from '../torznab/fixtures/index.ts'
import { apprise } from './channels/apprise.ts'
import {
  createChannel,
  decryptConfig,
  getChannel,
  recordDelivery,
} from './channels/store.ts'
import { telegram } from './channels/telegram.ts'
import { webhookFormatOf } from './channels/webhook.ts'
import { deliveryTiming, idleDelivery, resetDelivery } from './delivery.ts'
import { createDownloadWatcher } from './downloads.ts'
import { listNotifications } from './inbox.ts'
import {
  createProblemMonitor,
  RECHECK_TIMEOUT_MS,
  REOPEN_QUIET_MS,
  RESOLUTION_MAX_AGE_MS,
  STARTUP_GRACE_MS,
} from './monitor.ts'
import { renderTest } from './render.ts'
import { announceServerUpdated, recheckProblem } from './schedule.ts'

const app = createApp()

function liveState(values: Partial<EngineTorrentState>): EngineTorrentState {
  return { ...fixtureState, ...values }
}
const fetchMock = vi.fn<typeof fetch>()
const TOKEN = '123456:secret-token'
const MINUTE = 60 * 1000
const defaultTiming = { ...deliveryTiming }
let owner: Record<string, string>

const indexerDown: AttentionItem = {
  kind: 'indexer_error',
  severity: 'error',
  section: 'sources',
  params: { count: 1, name: 'Local' },
}

const storagePaused: AttentionItem = {
  kind: 'storage_paused',
  severity: 'warning',
  section: 'storage',
  params: { count: 2 },
}

function channel(values: Partial<ChannelInput> = {}) {
  return createChannel({
    kind: 'telegram',
    name: 'Telegram',
    enabled: true,
    language: 'en_US',
    panelUrl: 'http://torsher.local:8080/panel',
    config: { token: TOKEN, chatId: '42' },
    events: ['problems', 'updates', 'downloads', 'devices'],
    includeWarnings: false,
    notifyResolved: false,
    ...values,
  })
}

function telegramOk() {
  return new Response(JSON.stringify({ ok: true, result: {} }), {
    headers: { 'content-type': 'application/json' },
  })
}

function sentTexts() {
  return fetchMock.mock.calls.map(([, init]) =>
    String(JSON.parse(String(init?.body ?? '{}')).text ?? ''),
  )
}

function inbox() {
  return listNotifications({ limit: 100 }).items
}

type Monitor = ReturnType<typeof createProblemMonitor>

/** Перепроверка завершается промисом: даём ему отработать */
function flush() {
  return new Promise(resolve => setTimeout(resolve, 0))
}

/** Три минутные проверки: с запасом на две подряд и перепроверку */
function confirm(monitor: Monitor, items: AttentionItem[], from = Date.now()) {
  for (let i = 0; i < 3; i++) monitor.tick(items, from + i * MINUTE)
}

beforeAll(async () => {
  await migrateDb()

  const user = createOwner({
    username: 'Owner',
    passwordHash: 'x',
  })

  owner = { [ACCESS_TOKEN_COOKIE]: signToken(user.id, 'user_access') }
})

beforeEach(() => {
  getDb().delete(notifications).run()
  getDb().delete(notificationChannels).run()
  getDb().delete(torrents).run()
  resetDelivery()
  Object.assign(deliveryTiming, defaultTiming, { retryDelaysMs: [0, 0, 0] })
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => telegramOk())
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(async () => {
  await idleDelivery()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('монитор проблем', () => {
  const settled = () =>
    createProblemMonitor({ startedAt: Date.now() - STARTUP_GRACE_MS })

  it('объявляет проблему один раз после двух проверок подряд', async () => {
    channel()

    const monitor = settled()
    const now = Date.now()

    monitor.tick([indexerDown], now)
    expect(inbox()).toHaveLength(0)

    monitor.tick([indexerDown], now + MINUTE)
    monitor.tick([indexerDown], now + 2 * MINUTE)
    await idleDelivery()

    expect(inbox()).toMatchObject([
      { kind: 'problem', problem: 'indexer_error' },
    ])
    expect(sentTexts()).toEqual([
      '<b>Torsher: problem</b>\nIndexer “Local” doesn\'t respond or rejects requests\n<a href="http://torsher.local:8080/panel/sources?filter=attention">Open the panel</a>',
    ])
  })

  it('запуск движка не проблема', () => {
    const monitor = settled()
    const starting: AttentionItem = {
      kind: 'engine_down',
      severity: 'warning',
      section: 'downloads',
      params: { reason: 'starting' },
    }

    monitor.tick([starting])
    monitor.tick([starting])

    expect(inbox()).toHaveLength(0)
  })

  it('в льготный период после старта молчит, потом объявляет', () => {
    const startedAt = Date.now()
    const monitor = createProblemMonitor({ startedAt })

    monitor.tick([indexerDown], startedAt + MINUTE)
    monitor.tick([indexerDown], startedAt + 2 * MINUTE)
    expect(inbox()).toHaveLength(0)

    monitor.tick([indexerDown], startedAt + STARTUP_GRACE_MS)
    expect(inbox()).toHaveLength(1)
  })

  it('«решено» — после двух проверок без проблемы и только по галочке', async () => {
    channel({ name: 'With resolved', notifyResolved: true })
    channel({ name: 'Without', config: { token: TOKEN, chatId: '7' } })

    const monitor = settled()
    const now = Date.now()

    confirm(monitor, [indexerDown], now)
    monitor.tick([], now + 3 * MINUTE)
    expect(inbox()[0]?.resolvedAt).toBeUndefined()

    monitor.tick([], now + 4 * MINUTE)
    expect(inbox()[0]?.resolvedAt).toBeDefined()

    // «Решено» наружу — только после окна тишины
    monitor.tick([], now + 4 * MINUTE + REOPEN_QUIET_MS)
    await idleDelivery()

    const chats = fetchMock.mock.calls.map(
      ([, init]) => JSON.parse(String(init?.body)).chat_id,
    )

    expect(chats.filter(id => id === '42')).toHaveLength(2)
    expect(chats.filter(id => id === '7')).toHaveLength(1)
    expect(sentTexts().at(-1)).toContain('Torsher: resolved')
  })

  it('вернувшаяся в окне тишины проблема открывается без сообщений наружу', async () => {
    channel({ notifyResolved: true })

    const monitor = settled()
    const now = Date.now()

    confirm(monitor, [indexerDown], now)
    monitor.tick([], now + 3 * MINUTE)
    monitor.tick([], now + 4 * MINUTE)
    expect(inbox()[0]?.resolvedAt).toBeDefined()

    confirm(monitor, [indexerDown], now + 5 * MINUTE)
    await idleDelivery()

    expect(inbox()).toHaveLength(1)
    expect(inbox()[0]).toMatchObject({
      resolvedAt: undefined,
      readAt: undefined,
    })
    // Ни «решено», ни второго «проблема»
    expect(sentTexts()).toHaveLength(1)

    // Окно после повтора: для каналов проблема так и не кончалась
    monitor.tick([], now + 8 * MINUTE + REOPEN_QUIET_MS)
    monitor.tick([], now + 9 * MINUTE + REOPEN_QUIET_MS)
    monitor.tick([], now + 9 * MINUTE + 2 * REOPEN_QUIET_MS)
    await idleDelivery()

    expect(sentTexts()).toHaveLength(2)
    expect(sentTexts()[1]).toContain('resolved')
  })

  it('«решено» уходит один раз после окна, повтор после него — новое объявление', async () => {
    channel({ notifyResolved: true })

    const monitor = settled()
    const now = Date.now()

    confirm(monitor, [indexerDown], now)
    monitor.tick([], now + 3 * MINUTE)
    monitor.tick([], now + 4 * MINUTE)
    monitor.tick([], now + 4 * MINUTE + REOPEN_QUIET_MS)
    monitor.tick([], now + 5 * MINUTE + REOPEN_QUIET_MS)
    await idleDelivery()

    expect(sentTexts()).toHaveLength(2)
    expect(sentTexts()[1]).toContain('resolved')

    confirm(monitor, [indexerDown], now + 6 * MINUTE + REOPEN_QUIET_MS)
    await idleDelivery()

    expect(inbox()).toHaveLength(2)
    expect(sentTexts()).toHaveLength(3)
    expect(sentTexts()[2]).toContain('Torsher: problem')
  })

  it('индексатор объявляется только после завершения перепроверки', async () => {
    const gate = Promise.withResolvers<void>()
    const recheck = vi.fn(() => gate.promise)
    const monitor = createProblemMonitor({
      startedAt: Date.now() - STARTUP_GRACE_MS,
      recheck,
    })
    const now = Date.now()

    monitor.tick([indexerDown, storagePaused], now)
    monitor.tick([indexerDown, storagePaused], now + MINUTE)
    await flush()

    expect(recheck).toHaveBeenCalledTimes(1)
    expect(recheck).toHaveBeenCalledWith('indexer_error')
    // Обычная проблема — после двух проверок, индексатор ждёт перепроверки
    expect(inbox().map(item => item.problem)).toEqual(['storage_paused'])

    // Перепроверка ещё идёт: сколько бы ни прошло тиков, объявления нет
    for (let minute = 2; minute <= 6; minute++)
      monitor.tick([indexerDown, storagePaused], now + minute * MINUTE)

    await flush()
    expect(inbox()).toHaveLength(1)

    gate.resolve()
    await flush()

    monitor.tick([indexerDown, storagePaused], now + 7 * MINUTE)
    expect(
      inbox()
        .map(item => item.problem)
        .sort(),
    ).toEqual(['indexer_error', 'storage_paused'])
    expect(recheck).toHaveBeenCalledTimes(1)

    // Пропала до объявления и появилась снова — новая перепроверка
    const other = createProblemMonitor({ startedAt: 0, recheck })
    const missing: AttentionItem = {
      ...indexerDown,
      kind: 'indexer_missing',
      severity: 'warning',
    }

    other.tick([missing], now)
    other.tick([], now + MINUTE)
    other.tick([missing], now + 2 * MINUTE)
    await flush()

    expect(recheck).toHaveBeenCalledTimes(3)
  })

  it('проблема пропала после перепроверки — объявления нет', async () => {
    const gate = Promise.withResolvers<void>()
    const monitor = createProblemMonitor({
      startedAt: 0,
      recheck: () => gate.promise,
    })
    const now = Date.now()

    monitor.tick([indexerDown], now)
    monitor.tick([indexerDown], now + MINUTE)
    gate.resolve()
    await flush()

    monitor.tick([], now + 2 * MINUTE)
    monitor.tick([], now + 3 * MINUTE)
    await idleDelivery()

    expect(inbox()).toHaveLength(0)
  })

  it('перепроверка индексаторов не трогает пропавшие из менеджера', async () => {
    getDb()
      .insert(indexers)
      .values([
        {
          name: 'Broken',
          url: 'http://broken.example/t',
          checkStatus: 'remote',
        },
        {
          name: 'Gone',
          url: 'http://gone.example/t',
          checkStatus: 'remote',
          missing: true,
        },
      ])
      .run()
    fetchMock.mockImplementation(async () => new Response(capsXml))

    try {
      await recheckProblem('indexer_error')
      await recheckProblem('indexer_missing')

      expect(
        fetchMock.mock.calls.map(([input]) => new URL(String(input)).host),
      ).toEqual(['broken.example'])
    }
    finally {
      getDb().delete(indexers).run()
    }
  })

  it('перепроверка сети ждёт идущую проверку и запускает свою', async () => {
    vi.spyOn(checkDeps, 'systemAddresses').mockResolvedValue(['203.0.113.1'])
    vi.spyOn(checkDeps, 'dohAddresses').mockResolvedValue(['203.0.113.1'])

    const first = Promise.withResolvers<Response>()
    let hostCalls = 0

    fetchMock.mockImplementation(async (input) => {
      hostCalls++

      return String(input).includes('api.themoviedb.org') && hostCalls <= 2
        ? first.promise
        : new Response('')
    })

    startCheck()

    let finished = false
    const recheck = recheckProblem('host_unreachable').then(() => {
      finished = true
    })

    await flush()
    // Идёт прежняя проверка обоих хостов TMDB: новая ещё не начата
    expect(hostCalls).toBe(2)
    expect(finished).toBe(false)

    first.resolve(new Response(''))
    await recheck

    expect(hostCalls).toBe(4)
    expect(checkState().running).toBe(false)
  })

  it('зависшая перепроверка заканчивается по таймауту', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    try {
      const monitor = createProblemMonitor({
        startedAt: 0,
        recheck: () => new Promise(() => {}),
      })
      const now = Date.now()

      monitor.tick([indexerDown], now)
      monitor.tick([indexerDown], now + MINUTE)
      await vi.advanceTimersByTimeAsync(RECHECK_TIMEOUT_MS - 1)
      monitor.tick([indexerDown], now + 2 * MINUTE)
      expect(inbox()).toHaveLength(0)

      await vi.advanceTimersByTimeAsync(1)
      monitor.tick([indexerDown], now + RECHECK_TIMEOUT_MS + 3 * MINUTE)
      expect(inbox()).toMatchObject([{ problem: 'indexer_error' }])
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('перепроверка до таймаута снимает таймер, поздний таймер ничего не меняет', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    try {
      const warn = vi.spyOn(logFor('notifications'), 'warn')
      const gate = Promise.withResolvers<void>()
      const monitor = createProblemMonitor({
        startedAt: 0,
        recheck: () => gate.promise,
      })
      const now = Date.now()

      monitor.tick([indexerDown], now)
      monitor.tick([indexerDown], now + MINUTE)
      gate.resolve()
      await vi.advanceTimersByTimeAsync(0)

      expect(vi.getTimerCount()).toBe(0)

      monitor.tick([indexerDown], now + 2 * MINUTE)
      await vi.advanceTimersByTimeAsync(RECHECK_TIMEOUT_MS)
      monitor.tick([indexerDown], now + RECHECK_TIMEOUT_MS + 3 * MINUTE)

      expect(inbox()).toMatchObject([{ problem: 'indexer_error' }])
      expect(warn).not.toHaveBeenCalled()
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('сбой перепроверки не роняет монитор и считается её концом', async () => {
    const monitor = createProblemMonitor({
      startedAt: 0,
      recheck: () => {
        throw new Error('boom')
      },
    })
    const now = Date.now()

    monitor.tick([indexerDown], now)
    await flush()
    monitor.tick([indexerDown], now + MINUTE)

    expect(inbox()).toHaveLength(1)
  })

  it('после перезапуска открытая проблема не повторяется', async () => {
    channel({ notifyResolved: true })

    const now = Date.now()
    const first = settled()

    confirm(first, [indexerDown], now)
    await idleDelivery()

    const restarted = settled()

    restarted.tick([indexerDown], now + 3 * MINUTE)
    restarted.tick([indexerDown], now + 4 * MINUTE)
    restarted.tick([], now + 5 * MINUTE)
    restarted.tick([], now + 6 * MINUTE)
    restarted.tick([], now + 6 * MINUTE + REOPEN_QUIET_MS)
    await idleDelivery()

    expect(inbox()).toHaveLength(1)
    expect(sentTexts()).toHaveLength(2)
    expect(sentTexts()[1]).toContain('resolved')
  })

  it('отложенное «решено» переживает перезапуск и уходит один раз после окна', async () => {
    channel({ notifyResolved: true })

    const now = Date.now()
    const first = settled()

    confirm(first, [indexerDown], now)
    first.tick([], now + 3 * MINUTE)
    first.tick([], now + 4 * MINUTE)
    await idleDelivery()
    expect(sentTexts()).toHaveLength(1)

    // Перезапуск за 2 минуты до конца окна тишины: льготный период кончится позже окна
    const startedAt = now + 2 * MINUTE + REOPEN_QUIET_MS
    const restarted = createProblemMonitor({ startedAt })

    restarted.tick([], startedAt + MINUTE)
    restarted.tick([], now + 4 * MINUTE + REOPEN_QUIET_MS)
    await idleDelivery()
    // Окно прошло, но льготный период ещё нет
    expect(sentTexts()).toHaveLength(1)

    restarted.tick([], startedAt + STARTUP_GRACE_MS)
    restarted.tick([], startedAt + STARTUP_GRACE_MS + MINUTE)
    await idleDelivery()

    expect(sentTexts()).toHaveLength(2)
    expect(sentTexts()[1]).toContain('resolved')
    expect(
      getDb().select().from(notifications).get()?.resolutionSentAt,
    ).toBeInstanceOf(Date)

    // Ещё один перезапуск «решено» не повторяет
    const again = createProblemMonitor({ startedAt: 0 })

    again.tick([], now + 30 * MINUTE)
    await idleDelivery()
    expect(sentTexts()).toHaveLength(2)
  })

  it('вернулась после перезапуска в окне — строка открыта, наружу ничего', async () => {
    channel({ notifyResolved: true })

    const now = Date.now()
    const first = settled()

    confirm(first, [indexerDown], now)
    first.tick([], now + 3 * MINUTE)
    first.tick([], now + 4 * MINUTE)
    await idleDelivery()

    const startedAt = now + 5 * MINUTE
    const restarted = createProblemMonitor({ startedAt })

    for (let minute = 1; minute <= 5; minute++)
      restarted.tick([indexerDown], startedAt + minute * MINUTE)

    await idleDelivery()

    expect(inbox()).toHaveLength(1)
    expect(inbox()[0]?.resolvedAt).toBeUndefined()
    expect(sentTexts()).toHaveLength(1)
    expect(
      getDb().select().from(notifications).get()?.resolutionSentAt,
    ).toBeNull()
  })

  it('решённая больше суток назад после перезапуска «решено» не шлёт', async () => {
    channel({ notifyResolved: true })

    const now = Date.now()

    getDb()
      .insert(notifications)
      .values({
        kind: 'problem',
        problem: 'indexer_error',
        severity: 'error',
        section: 'sources',
        params: { count: 1, name: 'Local' },
        createdAt: new Date(now - RESOLUTION_MAX_AGE_MS - 2 * MINUTE),
        resolvedAt: new Date(now - RESOLUTION_MAX_AGE_MS - MINUTE),
      })
      .run()

    const restarted = settled()

    restarted.tick([], now)
    restarted.tick([], now + REOPEN_QUIET_MS)
    await idleDelivery()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('предупреждения — только по галочке', async () => {
    channel({ name: 'Errors only' })
    channel({
      name: 'Warnings',
      includeWarnings: true,
      config: { token: TOKEN, chatId: '7' },
    })

    const monitor = settled()

    monitor.tick([storagePaused])
    monitor.tick([storagePaused])
    await idleDelivery()

    expect(inbox()).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)).chat_id).toBe(
      '7',
    )
  })

  it('число элементов меняется — проблема та же', () => {
    const monitor = settled()

    confirm(monitor, [indexerDown])
    monitor.tick([{ ...indexerDown, params: { count: 3 } }])

    expect(inbox()).toMatchObject([{ params: { count: 3 } }])
  })
})

describe('завершённые загрузки', () => {
  function addTorrent(name: string, origin: 'search' | 'follow' = 'search') {
    return getDb()
      .insert(torrents)
      .values({
        infoHash: name.padEnd(40, '0'),
        name,
        source: 'magnet',
        status: 'ready',
        inEngine: true,
        origin,
      })
      .returning()
      .get()
  }

  const downloading = (infoHash: string) =>
    liveState({ infoHash, bytesWanted: 100, wantedCompleted: 40 })
  const done = (infoHash: string) =>
    liveState({
      infoHash,
      bytesWanted: 100,
      wantedCompleted: 100,
      seeding: true,
    })

  it('сообщает о переходе «качается» → «скачано» один раз', () => {
    const row = addTorrent('Big Buck Bunny')
    const watcher = createDownloadWatcher()

    watcher.tick(new Map([[row.infoHash, downloading(row.infoHash)]]))
    watcher.tick(new Map([[row.infoHash, done(row.infoHash)]]))
    watcher.tick(new Map([[row.infoHash, done(row.infoHash)]]))

    expect(inbox()).toMatchObject([
      { kind: 'download_completed', params: { name: 'Big Buck Bunny' } },
    ])
  })

  it('о закачке «Следить» сообщает слежение, а не «Загрузка завершена»', () => {
    const row = addTorrent('Synthetic.Show.S01', 'follow')
    const watcher = createDownloadWatcher()

    watcher.tick(new Map([[row.infoHash, downloading(row.infoHash)]]))
    watcher.tick(new Map([[row.infoHash, done(row.infoHash)]]))

    expect(inbox()).toHaveLength(0)
  })

  it('уже скачанная после старта не сообщается', () => {
    const row = addTorrent('Sintel')
    const watcher = createDownloadWatcher()

    watcher.tick(new Map([[row.infoHash, done(row.infoHash)]]))

    expect(inbox()).toHaveLength(0)
  })
})

describe('каналы', () => {
  const message = renderTest('ru_RU', 'http://torsher.local/panel/')

  it('telegram экранирует HTML и не светит токен в ошибке', async () => {
    await telegram.send(
      { ...message, text: 'a <b> & "c"' },
      { token: TOKEN, chatId: '42' },
    )

    const [url, init] = fetchMock.mock.calls[0]!
    const body = JSON.parse(String(init?.body))

    expect(String(url)).toBe(
      `https://api.telegram.org/bot${TOKEN}/sendMessage`,
    )
    expect(body).toMatchObject({ chat_id: '42', parse_mode: 'HTML' })
    expect(body.text).toContain('a &lt;b&gt; &amp; &quot;c&quot;')
    expect(body.text).toContain(
      '<a href="http://torsher.local/panel/settings/notifications">Открыть панель</a>',
    )

    fetchMock.mockRejectedValueOnce(
      new TypeError(`fetch failed for ${String(url)}`),
    )

    const error = await telegram
      .send(message, { token: TOKEN, chatId: '42' })
      .catch(err => err)

    expect(error).toMatchObject({ kind: 'unavailable' })
    expect(String(error.message)).not.toContain(TOKEN)
  })

  it('telegram: 429 с retry_after и неверный токен', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: false,
          error_code: 429,
          parameters: { retry_after: 7 },
        }),
        { status: 429 },
      ),
    )

    await expect(
      telegram.send(message, { token: TOKEN, chatId: '42' }),
    ).rejects.toMatchObject({
      kind: 'rate_limited',
      retryAfterMs: 7000,
    })

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, error_code: 401 }), {
        status: 401,
      }),
    )

    await expect(
      telegram.send(message, { token: TOKEN, chatId: '42' }),
    ).rejects.toMatchObject({
      kind: 'unauthorized',
    })
  })

  it('вебхук выбирает формат по хосту', () => {
    expect(
      webhookFormatOf('https://discord.com/api/webhooks/1/x', 'auto'),
    ).toBe('discord')
    expect(
      webhookFormatOf('https://hooks.slack.com/services/a/b', 'auto'),
    ).toBe('slack')
    expect(webhookFormatOf('https://ha.example/api/webhook/x', 'auto')).toBe(
      'json',
    )
    expect(webhookFormatOf('https://ha.example/x', 'slack')).toBe('slack')
  })
})

describe('доставка', () => {
  it('повторяет при сбое сети и записывает успех', async () => {
    const row = channel()

    fetchMock
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(telegramOk())

    confirm(createProblemMonitor({ startedAt: 0 }), [indexerDown])
    await idleDelivery()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(getChannel(row.id)).toMatchObject({ lastError: null })
    expect(getChannel(row.id)?.lastSentAt).toBeInstanceOf(Date)
  })

  it('неверный токен не повторяет и сообщает в центр один раз', async () => {
    const row = channel()

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error_code: 401 }), {
        status: 401,
      }),
    )

    const monitor = createProblemMonitor({ startedAt: 0 })
    const now = Date.now()
    const storageFailed: AttentionItem = {
      ...storagePaused,
      severity: 'error',
    }

    monitor.tick([indexerDown, storagePaused], now)
    monitor.tick([indexerDown, storageFailed], now + MINUTE)
    monitor.tick([indexerDown, storageFailed], now + 2 * MINUTE)
    await idleDelivery()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(getChannel(row.id)?.lastError).toMatchObject({
      kind: 'unauthorized',
    })
    expect(
      inbox().filter(item => item.kind === 'channel_failing'),
    ).toHaveLength(1)
  })

  it('сверх часового лимита — одна сводка', async () => {
    Object.assign(deliveryTiming, { hourlyLimit: 1, hourMs: 50 })
    channel({ events: ['downloads'] })

    const watcher = createDownloadWatcher()
    const names = ['A', 'B', 'C']
    const rows = names.map(name =>
      getDb()
        .insert(torrents)
        .values({
          infoHash: name.padEnd(40, '1'),
          name,
          source: 'magnet',
          status: 'ready',
          inEngine: true,
        })
        .returning()
        .get(),
    )

    watcher.tick(
      new Map(
        rows.map(row => [
          row.infoHash,
          liveState({
            infoHash: row.infoHash,
            bytesWanted: 10,
            wantedCompleted: 1,
          }),
        ]),
      ),
    )
    watcher.tick(
      new Map(
        rows.map(row => [
          row.infoHash,
          liveState({
            infoHash: row.infoHash,
            bytesWanted: 10,
            wantedCompleted: 10,
          }),
        ]),
      ),
    )
    await idleDelivery()
    await new Promise(resolve => setTimeout(resolve, 80))
    await idleDelivery()

    expect(sentTexts()).toHaveLength(2)
    expect(sentTexts()[1]).toContain('2 more notifications are in the panel')
  })
})

describe('routes /api/notifications', () => {
  const input = {
    kind: 'telegram',
    name: 'Telegram',
    language: 'ru_RU',
    panelUrl: 'http://torsher.local:8080/panel/',
    config: { token: TOKEN, chatId: '42' },
    events: ['problems'],
    enabled: true,
    includeWarnings: false,
    notifyResolved: false,
  }

  it('только для владельца', async () => {
    const res = await app.inject({ url: '/api/notifications' })

    expect(res.statusCode).toBe(401)
  })

  it('хранит секрет шифртекстом и не отдаёт его', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/notifications/channels',
      cookies: owner,
      payload: input,
    })

    expect(created.statusCode).toBe(201)
    expect(created.json()).toMatchObject({
      kind: 'telegram',
      config: { chatId: '42' },
      secrets: ['token'],
      panelUrl: 'http://torsher.local:8080/panel',
    })
    expect(created.body).not.toContain(TOKEN)

    const stored = getChannel(created.json().id)!

    expect(String(stored.config.token)).toMatch(/^v1:/)

    // Правка без токена оставляет сохранённый
    const updated = await app.inject({
      method: 'PUT',
      url: `/api/notifications/channels/${stored.id}`,
      cookies: owner,
      payload: { ...input, name: 'Phone', config: { token: '', chatId: '43' } },
    })

    expect(updated.json()).toMatchObject({ name: 'Phone', secrets: ['token'] })

    const tested = await app.inject({
      method: 'POST',
      url: `/api/notifications/channels/${stored.id}/test`,
      cookies: owner,
    })

    expect(tested.json()).toEqual({ ok: true })
    expect(String(fetchMock.mock.calls[0]![0])).toContain(TOKEN)
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)).chat_id).toBe(
      '43',
    )
  })

  it('неверные настройки — 422 с полями', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/notifications/channels',
      cookies: owner,
      payload: { ...input, config: { token: 'nope', chatId: '' } },
    })

    expect(res.statusCode).toBe(422)
    expect(res.json().fields).toEqual(
      expect.arrayContaining(['token', 'chatId']),
    )
  })

  it('тест черновика отвечает видом ошибки', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 404 }))

    const res = await app.inject({
      method: 'POST',
      url: '/api/notifications/channels/test',
      cookies: owner,
      payload: {
        ...input,
        kind: 'ntfy',
        config: {
          server: 'https://ntfy.example',
          topic: 'torsher',
          token: 'tk',
        },
      },
    })

    expect(res.json()).toMatchObject({
      ok: false,
      kind: 'not_found',
      status: 404,
    })

    const [url, init] = fetchMock.mock.calls[0]!

    expect(String(url)).toBe('https://ntfy.example/')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer tk')
    expect(JSON.parse(String(init?.body))).toMatchObject({
      topic: 'torsher',
      priority: 2,
    })
  })

  async function put(id: string, payload: Record<string, unknown>) {
    return app.inject({
      method: 'PUT',
      url: `/api/notifications/channels/${id}`,
      cookies: owner,
      payload: { ...input, ...payload },
    })
  }

  async function testSaved(id: string) {
    return app.inject({
      method: 'POST',
      url: `/api/notifications/channels/${id}/test`,
      cookies: owner,
    })
  }

  function lastAuthorization() {
    return new Headers(fetchMock.mock.calls.at(-1)?.[1]?.headers).get(
      'authorization',
    )
  }

  it('нерасшифровываемый сохранённый секрет — 422 с полем, новый — сохраняется', async () => {
    const row = channel()

    getDb()
      .update(notificationChannels)
      .set({ config: { ...row.config, token: 'v1:broken' } })
      .run()

    const kept = await put(row.id, { config: { token: '', chatId: '42' } })

    expect(kept.statusCode).toBe(422)
    expect(kept.json().fields).toEqual(['token'])

    const draft = await app.inject({
      method: 'POST',
      url: '/api/notifications/channels/test',
      cookies: owner,
      payload: { ...input, id: row.id, config: { chatId: '42' } },
    })

    expect(draft.statusCode).toBe(422)
    expect(draft.json().fields).toEqual(['token'])

    const replaced = await put(row.id, {
      config: { token: '654321:new-token', chatId: '42' },
    })

    expect(replaced.statusCode).toBe(200)

    await testSaved(row.id)
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain(
      '654321:new-token',
    )
  })

  it('null удаляет необязательный секрет, смена сервера ntfy не переносит токен', async () => {
    const ntfyInput = {
      kind: 'ntfy',
      config: { server: 'https://ntfy.example', topic: 'torsher', token: 'tk' },
    }
    const row = channel(ntfyInput as Partial<ChannelInput>)

    const same = await put(row.id, {
      ...ntfyInput,
      config: { ...ntfyInput.config, token: '' },
    })

    expect(same.json().secrets).toEqual(['token'])

    const moved = await put(row.id, {
      ...ntfyInput,
      config: { server: 'https://other.example', topic: 'torsher' },
    })

    expect(moved.json().secrets).toEqual([])

    await testSaved(row.id)
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toBe(
      'https://other.example/',
    )
    expect(lastAuthorization()).toBeNull()

    await put(row.id, {
      ...ntfyInput,
      config: { ...ntfyInput.config, server: 'https://other.example' },
    })

    const cleared = await put(row.id, {
      ...ntfyInput,
      config: {
        ...ntfyInput.config,
        server: 'https://other.example',
        token: null,
      },
    })

    expect(cleared.json().secrets).toEqual([])
  })

  it('секрет из одних пробелов оставляет сохранённый', async () => {
    const ntfyInput = {
      kind: 'ntfy',
      config: { server: 'https://ntfy.example', topic: 'torsher', token: 'tk' },
    }
    const ntfy = channel(ntfyInput as Partial<ChannelInput>)
    const ntfyKept = await put(ntfy.id, {
      ...ntfyInput,
      config: { ...ntfyInput.config, token: '   ' },
    })

    expect(ntfyKept.statusCode).toBe(200)
    expect(ntfyKept.json().secrets).toEqual(['token'])
    await testSaved(ntfy.id)
    expect(lastAuthorization()).toBe('Bearer tk')

    const webhookInput = {
      kind: 'webhook',
      config: {
        url: 'https://ha.example/hook/a',
        format: 'json',
        authorization: 'Bearer x',
      },
    }
    const webhook = channel(webhookInput as Partial<ChannelInput>)
    const webhookKept = await put(webhook.id, {
      ...webhookInput,
      config: {
        url: 'https://ha.example/hook/a',
        format: 'json',
        authorization: '  ',
      },
    })

    expect(webhookKept.statusCode).toBe(200)
    expect(webhookKept.json().secrets).toEqual(['url', 'authorization'])
    await testSaved(webhook.id)
    expect(lastAuthorization()).toBe('Bearer x')

    const appriseInput = {
      kind: 'apprise',
      config: {
        server: 'https://apprise.example',
        key: 'torsher',
        urls: 'tgram://bot/chat',
      },
    }
    const appriseRow = channel(appriseInput as Partial<ChannelInput>)
    const appriseKept = await put(appriseRow.id, {
      ...appriseInput,
      config: { ...appriseInput.config, urls: '   ' },
    })

    expect(appriseKept.statusCode).toBe(200)
    expect(appriseKept.json().secrets).toEqual(['urls'])
    expect(decryptConfig(apprise, getChannel(appriseRow.id)!.config).urls).toBe(
      'tgram://bot/chat',
    )
  })

  it('обязательный токен из пробелов: при правке прежний, без сохранённого — 422', async () => {
    const gotifyInput = {
      kind: 'gotify',
      config: { server: 'https://gotify.example', token: 'gt' },
    }
    const gotify = channel(gotifyInput as Partial<ChannelInput>)
    const gotifyKept = await put(gotify.id, {
      ...gotifyInput,
      config: { ...gotifyInput.config, token: '   ' },
    })

    expect(gotifyKept.statusCode).toBe(200)
    expect(gotifyKept.json().secrets).toEqual(['token'])
    await testSaved(gotify.id)
    expect(
      new Headers(fetchMock.mock.calls.at(-1)?.[1]?.headers).get(
        'x-gotify-key',
      ),
    ).toBe('gt')

    const row = channel()
    const telegramKept = await put(row.id, {
      config: { token: '   ', chatId: '42' },
    })

    expect(telegramKept.statusCode).toBe(200)
    expect(telegramKept.json().secrets).toEqual(['token'])
    await testSaved(row.id)
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain(TOKEN)

    const created = await app.inject({
      method: 'POST',
      url: '/api/notifications/channels',
      cookies: owner,
      payload: { ...input, config: { token: '   ', chatId: '42' } },
    })

    expect(created.statusCode).toBe(422)
    expect(created.json().fields).toEqual(['token'])
  })

  it('новый адрес вебхука без заголовка — заголовок не переносится', async () => {
    const webhookInput = {
      kind: 'webhook',
      config: {
        url: 'https://ha.example/hook/a',
        format: 'json',
        authorization: 'Bearer x',
      },
    }
    const row = channel(webhookInput as Partial<ChannelInput>)

    // Тот же адрес, введённый заново, заголовок оставляет
    await put(row.id, {
      ...webhookInput,
      config: { url: 'https://ha.example/hook/a', format: 'json' },
    })
    await testSaved(row.id)
    expect(lastAuthorization()).toBe('Bearer x')

    const moved = await put(row.id, {
      ...webhookInput,
      config: { url: 'https://ha.example/hook/b', format: 'json' },
    })

    expect(moved.json().secrets).toEqual(['url'])

    await testSaved(row.id)
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toBe(
      'https://ha.example/hook/b',
    )
    expect(lastAuthorization()).toBeNull()
  })

  it('правка и удачный тест сбрасывают ошибку, неудачный тест её не пишет', async () => {
    const row = channel()

    recordDelivery(row.id, { ok: false, kind: 'unauthorized' })

    const edited = await put(row.id, { config: { token: '', chatId: '42' } })

    expect(edited.json().lastError).toBeUndefined()

    recordDelivery(row.id, { ok: false, kind: 'unauthorized' })
    expect((await testSaved(row.id)).json()).toEqual({ ok: true })
    expect(getChannel(row.id)?.lastError).toBeNull()

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, error_code: 401 }), {
        status: 401,
      }),
    )
    expect((await testSaved(row.id)).json()).toMatchObject({
      ok: false,
      kind: 'unauthorized',
    })
    expect(getChannel(row.id)?.lastError).toBeNull()
  })

  it('лента, непрочитанные и «прочитать все»', async () => {
    confirm(createProblemMonitor({ startedAt: 0 }), [
      indexerDown,
      storagePaused,
    ])

    const unread = await app.inject({
      url: '/api/notifications/unread',
      cookies: owner,
    })

    expect(unread.json()).toEqual({ count: 2 })

    const page = await app.inject({
      url: '/api/notifications?limit=1',
      cookies: owner,
    })

    expect(page.json().items).toHaveLength(1)
    expect(page.json().nextCursor).toBeDefined()

    const next = await app.inject({
      url: `/api/notifications?limit=1&before=${page.json().nextCursor}`,
      cookies: owner,
    })

    expect(next.json().items).toHaveLength(1)
    expect(next.json().items[0].id).not.toBe(page.json().items[0].id)
    expect(next.json().nextCursor).toBeUndefined()

    await app.inject({
      method: 'POST',
      url: '/api/notifications/read',
      cookies: owner,
      payload: { all: true },
    })

    const after = await app.inject({
      url: '/api/notifications/unread',
      cookies: owner,
    })

    expect(after.json()).toEqual({ count: 0 })
  })
})

describe('«Обновлено до X»', () => {
  it('только если версия выросла, откат не объявляется', () => {
    announceServerUpdated('0.4.0', '0.3.0')
    expect(inbox()).toHaveLength(0)

    announceServerUpdated('0.3.0', '0.4.0')
    expect(inbox()).toMatchObject([
      { kind: 'server_updated', params: { from: '0.3.0', version: '0.4.0' } },
    ])
  })
})
