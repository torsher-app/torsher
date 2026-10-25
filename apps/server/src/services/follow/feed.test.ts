import type { FeedCursor, Follow } from '../../db/schema.ts'
import { eq } from 'drizzle-orm'
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
  followHistory,
  follows,
  indexers,
  libraries,
  libraryFolders,
  mediaFiles,
  metaCache,
  serverSettings,
  titleAliases,
} from '../../db/schema.ts'
import { setSetting } from '../settings/index.ts'
import { clearSearchCache } from '../sources/cache.ts'
import { tvOngoing } from '../tmdb/fixtures/index.ts'
import {
  confirmUnsure,
  feedJitter,
  feedPass,
  isFeedDue,
  resetFollowIndex,
  rssIntervalMin,
} from './feed.ts'
import { activeFollows } from './pass.ts'
import { underFollowLock } from './schedule.ts'
import { requestedSearch, resetFollowSearch } from './search.ts'
import { localDay } from './wanted.ts'

const SERIES = 'tmdb:tv:3000'
const GB = 1024 ** 3
const DAY_MS = 24 * 60 * 60 * 1000
const MINUTE_MS = 60 * 1000
const fetchMock = vi.fn<typeof fetch>()
async function noWait() {}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function day(offset: number) {
  return localDay(new Date(Date.now() + offset * DAY_MS))
}

// Идёт второй сезон из 12 серий: вышли 1–8, последняя — вчера
function series() {
  return {
    ...tvOngoing,
    id: 3000,
    name: 'Тихая гавань',
    original_name: 'Quiet Harbor',
    original_language: 'en',
    first_air_date: '2023-05-01',
    status: 'Returning Series',
    last_episode_to_air: {
      season_number: 2,
      episode_number: 8,
      air_date: day(-1),
    },
    next_episode_to_air: {
      season_number: 2,
      episode_number: 9,
      air_date: day(6),
    },
    seasons: [
      {
        season_number: 1,
        name: 'S1',
        episode_count: 8,
        air_date: '2023-05-01',
      },
      { season_number: 2, name: 'S2', episode_count: 12, air_date: day(-50) },
    ],
  }
}

function season2() {
  return {
    season_number: 2,
    name: 'S2',
    episodes: Array.from({ length: 12 }, (_, index) => ({
      episode_number: index + 1,
      name: `Episode ${index + 1}`,
      air_date: day(-1 - (7 - index) * 7),
      runtime: 50,
    })),
  }
}

interface Item {
  title: string
  hash: string
  /** Минут назад */
  age: number
  /** Без guid, адреса страницы и даты: позицию не узнать */
  bare?: boolean
}

function feedXml(items: Item[]) {
  const body = items
    .map(
      item => `<item>
  <title>${item.title}</title>
  ${
    item.bare
      ? ''
      : `<guid>https://tracker.example/topic/${item.hash.slice(0, 6)}</guid>
  <comments>https://tracker.example/topic/${item.hash.slice(0, 6)}</comments>
  <pubDate>${new Date(Date.now() - item.age * MINUTE_MS).toUTCString()}</pubDate>`
  }
  <size>${1.5 * GB}</size>
  <torznab:attr name="seeders" value="30" />
  <torznab:attr name="infohash" value="${item.hash}" />
</item>`,
    )
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed"><channel>${body}</channel></rss>`
}

function hash(n: number) {
  return n.toString(16).padStart(40, '0')
}

const EPISODE_8
  = 'Тихая гавань / Quiet Harbor / Сезон: 2 / Серии: 8 из 12 (2024) WEB-DL 1080p | NewStudio'
const OTHER_SHOW
  = 'Далёкий берег / Far Shore / Сезон: 1 / Серии: 3 из 10 (2024) WEB-DL 1080p'

/** Позиции, которые уже были в ленте до курсора */
function filler(from: number, count: number, age: number): Item[] {
  return Array.from({ length: count }, (_, index) => ({
    title: `Синтетика ${from + index} / Synthetic ${from + index} (2020) DVDRip`,
    hash: hash(from + index),
    age: age + index,
  }))
}

/** Ленты индексаторов по хосту: страница по `offset` */
const feeds = new Map<string, Item[]>()
let ignoresOffset = false
let requests: { host: string, params: URLSearchParams }[] = []
let folderId = ''

function cursorAt(item: Item): FeedCursor {
  return {
    guid: `https://tracker.example/topic/${item.hash.slice(0, 6)}`,
    detailsUrl: `https://tracker.example/topic/${item.hash.slice(0, 6)}`,
    infoHash: item.hash,
    publishedAt: new Date(Date.now() - item.age * MINUTE_MS).toISOString(),
  }
}

function insertIndexer(name: string, host: string, values = {}) {
  return getDb()
    .insert(indexers)
    .values({
      name,
      url: `https://${host}/torznab`,
      checkStatus: 'ok',
      caps: {
        search: { available: true, params: ['q'] },
        tvSearch: { available: true, params: ['q'] },
        movieSearch: { available: false, params: [] },
        categories: [],
        limits: { max: 5, default: 5 },
      },
      ...values,
    })
    .returning()
    .get()
}

function insertFollow(values: Partial<Follow> = {}) {
  return getDb()
    .insert(follows)
    .values({
      titleId: SERIES,
      kind: 'series',
      state: 'active',
      startSeason: 2,
      startEpisode: 1,
      requireRussian: true,
      waitHours: 24,
      voiceStudio: 'LostFilm',
      // Целевой поиск уже был: проход ленты его не трогает
      lastSearchAt: new Date(),
      nextSearchAt: new Date(Date.now() + DAY_MS),
      ...values,
    })
    .returning()
    .get()
}

function libraryEpisodes(...numbers: number[]) {
  for (const episode of numbers) {
    getDb()
      .insert(mediaFiles)
      .values({
        folderId,
        relPath: `Quiet Harbor/Season 02/E${episode}.mkv`,
        size: 1000,
        mtime: new Date(),
        titleId: SERIES,
        season: 2,
        episode,
      })
      .run()
  }
}

function episodeRows(followId: string) {
  return getDb()
    .select()
    .from(followEpisodes)
    .where(eq(followEpisodes.followId, followId))
    .all()
}

function history() {
  return getDb().select().from(followHistory).all()
}

function indexerRow(id: string) {
  return getDb().select().from(indexers).where(eq(indexers.id, id)).get()!
}

beforeAll(async () => {
  await migrateDb()

  const library = getDb()
    .insert(libraries)
    .values({ kind: 'video', name: 'Library', managed: true })
    .returning()
    .get()

  folderId = getDb()
    .insert(libraryFolders)
    .values({ libraryId: library.id, path: '/library' })
    .returning()
    .get()
    .id
})

beforeEach(() => {
  for (const table of [
    follows,
    followHistory,
    mediaFiles,
    metaCache,
    indexers,
    titleAliases,
    serverSettings,
  ])
    getDb().delete(table).run()

  clearSearchCache()
  resetFollowSearch(0)
  resetFollowIndex()
  feeds.clear()
  ignoresOffset = false
  requests = []
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input) => {
    const url = new URL(String(input))

    if (url.pathname === '/3/tv/3000')
      return json(series())

    if (url.pathname === '/3/tv/3000/season/2')
      return json(season2())

    if (url.hostname === 'api.themoviedb.org')
      return json({ status_message: 'not found' }, 404)

    if (url.pathname === '/torznab/api') {
      requests.push({ host: url.hostname, params: url.searchParams })

      const limit = Number(url.searchParams.get('limit'))
      const offset = ignoresOffset
        ? 0
        : Number(url.searchParams.get('offset') ?? 0)
      const items = feeds.get(url.hostname) ?? []

      return new Response(feedXml(items.slice(offset, offset + limit)))
    }

    return json({ message: 'not found' }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('TMDB_ACCESS_TOKEN', 'test-token')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('интервал и срок ленты', () => {
  it('по умолчанию 15 мин, 0 выключает, остальное — в 10–120', () => {
    expect(rssIntervalMin()).toBe(15)
    setSetting('follow', { rssIntervalMin: 0 })
    expect(rssIntervalMin()).toBe(0)
    setSetting('follow', { rssIntervalMin: 3 })
    expect(rssIntervalMin()).toBe(10)
    setSetting('follow', { rssIntervalMin: 500 })
    expect(rssIntervalMin()).toBe(120)
  })

  it('разброс — не больше минуты, выключенная лента пробуется раз в неделю', () => {
    const checkedAt = new Date('2026-10-25T12:00:00Z')

    for (const id of ['a', 'b', 'c', 'd']) {
      expect(Math.abs(feedJitter(id, checkedAt))).toBeLessThanOrEqual(
        MINUTE_MS,
      )
    }

    const at = (minutes: number) =>
      new Date(checkedAt.getTime() + minutes * MINUTE_MS)
    const indexer = { id: 'a', rssCheckedAt: checkedAt, rssFailures: 0 }

    expect(isFeedDue(indexer, 15 * MINUTE_MS, at(13))).toBe(false)
    expect(isFeedDue(indexer, 15 * MINUTE_MS, at(17))).toBe(true)

    const disabled = { ...indexer, rssFailures: 3 }

    expect(isFeedDue(disabled, 15 * MINUTE_MS, at(60 * 24))).toBe(false)
    expect(isFeedDue(disabled, 15 * MINUTE_MS, at(60 * 24 * 7))).toBe(true)
  })
})

describe('проход ленты', () => {
  it('курсор на первой странице: один запрос, только новые позиции', async () => {
    libraryEpisodes(1, 2, 3, 4, 5, 6, 7)

    const seen = filler(100, 3, 30)
    const indexer = insertIndexer('Indexer A', 'a.indexer.example', {
      rssCursor: cursorAt(seen[0]!),
      rssCheckedAt: new Date(Date.now() - DAY_MS),
    })
    const follow = insertFollow()
    const fresh = { title: EPISODE_8, hash: hash(1), age: 5 }

    feeds.set('a.indexer.example', [fresh, ...seen])

    await feedPass(activeFollows(), new Date(), { wait: noWait })

    expect(requests).toHaveLength(1)
    expect(Object.fromEntries(requests[0]!.params)).toMatchObject({
      t: 'search',
      limit: '5',
      extended: '1',
    })
    expect(requests[0]!.params.has('q')).toBe(false)
    expect(requests[0]!.params.has('cat')).toBe(false)
    expect(requests[0]!.params.has('offset')).toBe(false)
    // Чужая студия ждёт окна: кандидат отложен
    expect(
      episodeRows(follow.id).map(row => [row.episode, row.pending?.title]),
    ).toEqual([[8, EPISODE_8]])
    expect(indexerRow(indexer.id)).toMatchObject({
      rssCursor: { infoHash: hash(1) },
      rssFailures: 0,
    })
    expect(history().map(row => row.kind)).not.toContain('gap')
  })

  it('пробел: три страницы не догнали курсор — запись и целевой поиск', async () => {
    libraryEpisodes(1, 2, 3, 4, 5, 6, 7)

    const old = filler(100, 1, 600)[0]!
    const cursor = cursorAt(old)
    const indexer = insertIndexer('Indexer A', 'a.indexer.example', {
      rssCursor: cursor,
      rssCheckedAt: new Date(Date.now() - DAY_MS),
    })
    const follow = insertFollow()

    feeds.set('a.indexer.example', [...filler(200, 20, 10), old])

    await feedPass(activeFollows(), new Date(), { wait: noWait })

    expect(requests.map(item => item.params.get('offset'))).toEqual([
      null,
      '5',
      '10',
    ])

    const gap = history().find(row => row.kind === 'gap')!

    expect(gap).toMatchObject({ titleId: null, indexerId: indexer.id })
    expect(gap.params.from).toBe(cursor.publishedAt)
    expect(new Date(String(gap.params.to)).getTime()).toBeLessThan(
      Date.now() - 20 * MINUTE_MS,
    )
    expect(requestedSearch(follow.id)).toBe('gap')
    // Курсор — самая свежая позиция первой страницы
    expect(indexerRow(indexer.id).rssCursor?.infoHash).toBe(hash(200))
  })

  it('индексатор без offset: вторая страница повторяет первую — пробел', async () => {
    libraryEpisodes(1, 2, 3, 4, 5, 6, 7)

    const old = filler(100, 1, 600)[0]!

    insertIndexer('Indexer A', 'a.indexer.example', {
      rssCursor: cursorAt(old),
      rssCheckedAt: new Date(Date.now() - DAY_MS),
    })
    insertFollow()
    ignoresOffset = true
    feeds.set('a.indexer.example', [...filler(200, 20, 10), old])

    await feedPass(activeFollows(), new Date(), { wait: noWait })

    expect(requests).toHaveLength(2)
    expect(history().map(row => row.kind)).toContain('gap')
  })

  it('лента, где позицию не узнать: пробел у того же курсора — один целевой поиск', async () => {
    libraryEpisodes(1, 2, 3, 4, 5, 6, 7)

    const items = filler(200, 3, 10).map(item => ({ ...item, bare: true }))

    insertIndexer('Indexer A', 'a.indexer.example', {
      rssCursor: { infoHash: items[0]!.hash },
      rssCheckedAt: new Date(Date.now() - DAY_MS),
    })

    const follow = insertFollow()
    const now = Date.now()

    feeds.set('a.indexer.example', items)
    await feedPass(activeFollows(), new Date(now), { wait: noWait })
    expect(requestedSearch(follow.id)).toBe('gap')

    // Поиск по пробелу прошёл
    resetFollowSearch(0)
    await feedPass(activeFollows(), new Date(now + 20 * MINUTE_MS), {
      wait: noWait,
    })

    expect(requests).toHaveLength(2)
    expect(requestedSearch(follow.id)).toBeUndefined()
  })

  it('повтор позиции из другого индексатора — один кандидат', async () => {
    libraryEpisodes(1, 2, 3, 4, 5, 6, 7)
    insertIndexer('Indexer A', 'a.indexer.example')
    insertIndexer('Indexer B', 'b.indexer.example')

    const follow = insertFollow()
    const item = { title: EPISODE_8, hash: hash(1), age: 5 }

    feeds.set('a.indexer.example', [item])
    feeds.set('b.indexer.example', [item])

    await feedPass(activeFollows(), new Date(), { wait: noWait })

    expect(requests.map(request => request.host).sort()).toEqual([
      'a.indexer.example',
      'b.indexer.example',
    ])

    const [row] = episodeRows(follow.id)

    expect(row!.decisions).toHaveLength(1)
    expect(row!.decisions![0]!.indexers.sort()).toEqual([
      'Indexer A',
      'Indexer B',
    ])
    expect(history().filter(entry => entry.kind === 'pending')).toHaveLength(
      1,
    )
  })

  it('позиция чужого тайтла не трогает решатель', async () => {
    libraryEpisodes(1, 2, 3, 4, 5, 6, 7)
    insertIndexer('Indexer A', 'a.indexer.example')

    const follow = insertFollow()

    feeds.set('a.indexer.example', [
      { title: OTHER_SHOW, hash: hash(1), age: 5 },
    ])

    await feedPass(activeFollows(), new Date(), { wait: noWait })

    expect(requests).toHaveLength(1)
    expect(episodeRows(follow.id)).toEqual([])
    expect(history()).toEqual([])
  })

  it('похоже, но не уверены — запись, «Это он» запоминает алиас и решает', async () => {
    libraryEpisodes(1, 2, 3, 4, 5, 6, 7)
    insertIndexer('Indexer A', 'a.indexer.example')

    const follow = insertFollow()
    const title
      = 'Тихая гавань Возвращение / Сезон: 2 / Серии: 8 из 12 (2024) WEB-DL 1080p | NewStudio'

    feeds.set('a.indexer.example', [{ title, hash: hash(1), age: 5 }])

    await feedPass(activeFollows(), new Date(), { wait: noWait })

    const unsure = history().filter(row => row.kind === 'unsure')

    expect(unsure).toHaveLength(1)
    expect(unsure[0]).toMatchObject({
      followId: follow.id,
      releaseTitle: title,
    })
    expect(episodeRows(follow.id)).toEqual([])

    expect(await confirmUnsure(unsure[0]!.id)).toBe('ok')
    // Решение идёт в фоне под замком тика
    await underFollowLock(async () => {})
    expect(
      getDb()
        .select()
        .from(titleAliases)
        .where(eq(titleAliases.kind, 'user'))
        .all()
        .map(alias => alias.value),
    ).toContain('Тихая гавань Возвращение')
    expect(
      episodeRows(follow.id).map(row => [row.episode, row.pending?.title]),
    ).toEqual([[8, title]])
  })

  it('лента выключена (0) — к индексаторам не ходит', async () => {
    setSetting('follow', { rssIntervalMin: 0 })
    insertIndexer('Indexer A', 'a.indexer.example')
    insertFollow()
    feeds.set('a.indexer.example', [
      { title: EPISODE_8, hash: hash(1), age: 5 },
    ])

    await feedPass(activeFollows(), new Date(), { wait: noWait })

    expect(requests).toEqual([])
  })

  it('лента, запрещённая в Prowlarr, не читается; три пустых ответа выключают до пробы', async () => {
    insertIndexer('Indexer A', 'a.indexer.example', { supportsRss: false })

    const empty = insertIndexer('Indexer B', 'b.indexer.example')

    insertFollow()

    const start = Date.now()

    for (let pass = 0; pass < 4; pass++) {
      await feedPass(activeFollows(), new Date(start + pass * DAY_MS), {
        wait: noWait,
      })
    }

    expect(requests.map(request => request.host)).toEqual([
      'b.indexer.example',
      'b.indexer.example',
      'b.indexer.example',
    ])
    expect(indexerRow(empty.id).rssFailures).toBe(3)

    await feedPass(activeFollows(), new Date(start + 9 * DAY_MS), {
      wait: noWait,
    })
    expect(requests).toHaveLength(4)
  })
})
