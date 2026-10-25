import type { Follow } from '../../db/schema.ts'
import { and, eq } from 'drizzle-orm'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { getDb, migrateDb } from '../../db/index.ts'
import {
  followEpisodes,
  follows,
  indexers,
  metaCache,
  notificationChannels,
  notifications,
  torrents,
} from '../../db/schema.ts'
import { recordBackgroundOutcome } from '../indexers/backoff.ts'
import { createChannel } from '../notifications/channels/store.ts'
import { idleDelivery, resetDelivery } from '../notifications/delivery.ts'
import { listNotifications } from '../notifications/inbox.ts'
import {
  createProblemMonitor,
  REOPEN_QUIET_MS,
  STARTUP_GRACE_MS,
} from '../notifications/monitor.ts'
import { tvOngoing } from '../tmdb/fixtures/index.ts'
import { followAttention } from './attention.ts'
import {
  announceLibrary,
  announceMissing,
  announceOtherVoice,
  announceWaiting,
  episodesText,
  LIBRARY_HOLD_MS,
} from './notify.ts'

const SERIES = 'tmdb:tv:3000'
const GIB = 1024 ** 3
const MINUTE = 60 * 1000
const DAY_MS = 24 * 60 * MINUTE
const fetchMock = vi.fn<typeof fetch>()
let originalLanguage = 'en'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function insertFollow(values: Partial<Follow> = {}) {
  return getDb()
    .insert(follows)
    .values({
      titleId: SERIES,
      kind: 'series',
      state: 'active',
      startSeason: 1,
      startEpisode: 1,
      requireRussian: false,
      waitHours: 24,
      ...values,
    })
    .returning()
    .get()
}

function insertTorrent(name: string) {
  return getDb()
    .insert(torrents)
    .values({
      infoHash: name.padEnd(40, '0').slice(0, 40),
      name,
      source: 'magnet',
      status: 'ready',
      inEngine: true,
      origin: 'follow',
    })
    .returning()
    .get()
}

function grabbed(
  follow: Follow,
  torrentId: string,
  season: number,
  episode: number,
  downloadedAt: Date | null,
) {
  getDb()
    .insert(followEpisodes)
    .values({
      followId: follow.id,
      season,
      episode,
      firstSeenAt: new Date(0),
      torrentId,
      fileIndex: episode,
      grabbedAt: new Date(0),
      grabbedTitle: 'Quiet.Harbor.S02.1080p.WEB-DL',
      downloadedAt,
    })
    .run()
}

function setDownloaded(follow: Follow, episode: number, at: Date) {
  getDb()
    .update(followEpisodes)
    .set({ downloadedAt: at })
    .where(
      and(
        eq(followEpisodes.followId, follow.id),
        eq(followEpisodes.episode, episode),
      ),
    )
    .run()
}

function inbox() {
  return listNotifications({ limit: 100 }).items
}

/** Тексты, ушедшие в Telegram */
function sent() {
  return fetchMock.mock.calls
    .filter(([input]) => String(input).includes('api.telegram.org'))
    .map(([, init]) => String(JSON.parse(String(init?.body ?? '{}')).text))
}

beforeAll(async () => {
  await migrateDb()
})

beforeEach(() => {
  for (const table of [
    follows,
    torrents,
    indexers,
    notifications,
    notificationChannels,
    metaCache,
  ])
    getDb().delete(table).run()

  resetDelivery()
  originalLanguage = 'en'
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input) => {
    const url = new URL(String(input))

    if (url.hostname === 'api.telegram.org')
      return json({ ok: true, result: {} })

    if (url.pathname === '/3/tv/3000') {
      const ru = url.searchParams.get('language') === 'ru-RU'

      return json({
        ...tvOngoing,
        id: 3000,
        name: ru ? 'Тихая гавань' : 'Quiet Harbor',
        original_name: 'Quiet Harbor',
        original_language: originalLanguage,
      })
    }

    return json({ status_message: 'not found' }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('TMDB_ACCESS_TOKEN', 'test-token')
  createChannel({
    kind: 'telegram',
    name: 'Telegram',
    enabled: true,
    language: 'ru_RU',
    panelUrl: 'http://torsher.local/panel',
    config: { token: '123456:secret-token', chatId: '42' },
    events: ['problems', 'follow'],
    includeWarnings: true,
    notifyResolved: true,
  })
})

afterEach(async () => {
  await idleDelivery()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('episodesText', () => {
  it('подряд — диапазоном, сезоны через запятую, фильм — пусто', () => {
    expect(
      episodesText([
        { season: 2, episode: 2 },
        { season: 2, episode: 1 },
        { season: 2, episode: 3 },
        { season: 2, episode: 5 },
        { season: 1, episode: 10 },
      ]),
    ).toBe('S1E10, S2E1–E3, E5')
    expect(episodesText([{ season: 0, episode: 0 }])).toBe('')
  })
})

describe('«в библиотеке»', () => {
  it('пак: ждёт соседние серии раздачи и сообщает о тайтле одним сообщением', async () => {
    const follow = insertFollow()
    const pack = insertTorrent('Quiet.Harbor.S02')
    const now = new Date()

    grabbed(follow, pack.id, 2, 1, now)
    grabbed(follow, pack.id, 2, 2, now)
    grabbed(follow, pack.id, 2, 3, null)

    await announceLibrary(follow, now)
    expect(inbox()).toEqual([])

    setDownloaded(follow, 3, now)
    await announceLibrary(follow, new Date(now.getTime() + MINUTE))
    await announceLibrary(follow, new Date(now.getTime() + 2 * MINUTE))
    await idleDelivery()

    expect(inbox()).toMatchObject([
      {
        kind: 'follow_downloaded',
        severity: 'info',
        section: 'follow',
        params: {
          titleId: SERIES,
          names: { ru_RU: 'Тихая гавань', en_US: 'Quiet Harbor' },
          episodes: 'S2E1–E3',
          count: 3,
          quality: '1080p',
        },
      },
    ])
    expect(sent()).toEqual([
      '<b>Серии в библиотеке</b>\n«Тихая гавань» · S2E1–E3 · 1080p\n<a href="http://torsher.local/panel/follow">Открыть панель</a>',
    ])
  })

  it('соседняя серия качается дольше часа — готовые сообщаются без неё', async () => {
    const follow = insertFollow()
    const pack = insertTorrent('Quiet.Harbor.S02')
    const now = new Date()

    grabbed(follow, pack.id, 2, 1, now)
    grabbed(follow, pack.id, 2, 2, null)

    await announceLibrary(
      follow,
      new Date(now.getTime() + LIBRARY_HOLD_MS - MINUTE),
    )
    expect(inbox()).toEqual([])

    await announceLibrary(follow, new Date(now.getTime() + LIBRARY_HOLD_MS))
    expect(inbox().map(item => item.params.episodes)).toEqual(['S2E1'])
  })

  it('разные сезоны и раздачи за проход — одно сообщение на тайтл', async () => {
    const follow = insertFollow()
    const now = new Date()

    grabbed(follow, insertTorrent('Quiet.Harbor.S01E08').id, 1, 8, now)
    grabbed(follow, insertTorrent('Quiet.Harbor.S02E01').id, 2, 1, now)

    await announceLibrary(follow, now)

    expect(inbox().map(item => item.params.episodes)).toEqual(['S1E8, S2E1'])
  })
})

describe('события только для центра', () => {
  it('«ждём вашу озвучку» — в центре, наружу не уходит', async () => {
    const follow = insertFollow()
    const until = new Date(Date.now() + 6 * 60 * MINUTE)

    await announceWaiting(follow, [
      {
        episodes: [{ season: 2, episode: 5 }],
        candidate: {
          id: 'r1',
          title: 'Quiet Harbor S02E05',
          seeders: 5,
          studio: 'Studio South',
          quality: '1080p',
        },
        until,
        wait: { studio: 'Studio North', until: until.toISOString() },
      },
    ])
    await idleDelivery()

    expect(inbox()).toMatchObject([
      {
        kind: 'follow_waiting',
        params: {
          episodes: 'S2E5',
          studio: 'Studio South',
          quality: '1080p',
          wait: { studio: 'Studio North' },
          until: until.toISOString(),
        },
      },
    ])
    expect(sent()).toEqual([])
  })

  it('«взяли другую озвучку» — только при своей студии и не у русского оригинала', async () => {
    const follow = insertFollow()
    const candidate = {
      id: 'r1',
      title: 'x',
      seeders: 1,
      studio: 'Studio South',
    }
    const episodes = [{ season: 2, episode: 5 }]

    await announceOtherVoice(follow, candidate, episodes, undefined)
    await announceOtherVoice(follow, candidate, episodes, 'studio south')
    expect(inbox()).toEqual([])

    await announceOtherVoice(follow, candidate, episodes, 'Studio North')
    await idleDelivery()

    expect(inbox()).toMatchObject([
      {
        kind: 'follow_other_voice',
        params: { studio: 'Studio South', own: 'Studio North' },
      },
    ])
    expect(sent()).toEqual([])

    getDb().delete(notifications).run()
    getDb().delete(metaCache).run()
    originalLanguage = 'ru'

    await announceOtherVoice(follow, candidate, episodes, 'Studio North')
    expect(inbox()).toEqual([])
  })
})

describe('«не нашли»', () => {
  it('предупреждение со сроком у одной серии уходит в канал «Следить»', async () => {
    const follow = insertFollow()
    const now = new Date(2026, 9, 25, 12)

    await announceMissing(
      follow,
      [{ season: 1, episode: 3, airDate: '2026-08-24' }],
      now,
    )
    await idleDelivery()

    expect(inbox()).toMatchObject([
      {
        kind: 'follow_missing',
        severity: 'warning',
        params: { episodes: 'S1E3', days: 62 },
      },
    ])
    expect(sent()).toEqual([
      '<b>Раздач нет</b>\n«Тихая гавань» · S1E3 вышла 62 дня назад, а раздач так и нет\n<a href="http://torsher.local/panel/follow">Открыть панель</a>',
    ])
  })
})

describe('проблемы «Следить» через монитор', () => {
  it('нехватка места объявляется один раз и снимается', async () => {
    const follow = insertFollow()

    getDb()
      .insert(followEpisodes)
      .values({
        followId: follow.id,
        season: 2,
        episode: 6,
        firstSeenAt: new Date(),
        pending: {
          id: 'pack',
          title: 'Quiet Harbor S02',
          seeders: 3,
          size: 4 * GIB,
        },
        stateNote: 'no_space',
      })
      .run()

    const start = Date.now()
    const monitor = createProblemMonitor({
      startedAt: start - STARTUP_GRACE_MS,
    })

    for (let i = 0; i < 3; i++)
      monitor.tick(followAttention(), start + i * MINUTE)
    await idleDelivery()

    expect(inbox()).toMatchObject([
      {
        kind: 'problem',
        problem: 'follow_no_space',
        severity: 'error',
        section: 'follow',
        params: { count: 1, need: 4 * GIB },
      },
    ])
    expect(sent()).toEqual([
      '<b>Torsher: проблема</b>\nНе хватает места для 1 серии из «Слежу»: нужно 4 ГБ\n<a href="http://torsher.local/panel/follow">Открыть панель</a>',
    ])

    getDb()
      .update(followEpisodes)
      .set({ stateNote: null, pending: null })
      .run()

    for (let i = 3; i < 5; i++)
      monitor.tick(followAttention(), start + i * MINUTE)

    expect(inbox()[0]!.resolvedAt).toBeDefined()

    monitor.tick(followAttention(), start + 5 * MINUTE + REOPEN_QUIET_MS)
    await idleDelivery()

    expect(sent()).toHaveLength(2)
    expect(sent()[1]).toContain('Torsher: решено')
  })

  it('серия ошибок фона помнит начало и сбрасывается успехом', () => {
    const indexer = getDb()
      .insert(indexers)
      .values({
        name: 'Slow',
        url: 'http://slow.example/torznab',
        checkStatus: 'ok',
      })
      .returning()
      .get()
    const asked = [{ ...indexer, apiKey: undefined }] as never
    const start = new Date()
    const failure = [
      { id: indexer.id, name: 'Slow', kind: 'unavailable' },
    ] as never
    const state = () =>
      getDb().select().from(indexers).where(eq(indexers.id, indexer.id)).get()!

    recordBackgroundOutcome(asked, failure, start)
    recordBackgroundOutcome(asked, failure, new Date(start.getTime() + DAY_MS))

    expect(state()).toMatchObject({ failureCount: 2, backoffSince: start })

    insertFollow()
    expect(
      followAttention(new Date(start.getTime() + 7 * 60 * MINUTE)),
    ).toEqual([
      {
        kind: 'follow_feed_limited',
        severity: 'warning',
        section: 'follow',
        params: { count: 1, name: 'Slow' },
      },
    ])

    recordBackgroundOutcome(asked, [], new Date(start.getTime() + 2 * DAY_MS))

    expect(state()).toMatchObject({ failureCount: 0, backoffSince: null })
    expect(followAttention()).toEqual([])
  })
})
