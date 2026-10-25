import type { TitleMatch } from '@torsher/release-parser'
import type { Follow } from '../../db/schema.ts'
import type { FoundRelease } from '../sources/rank.ts'
import { parseRelease } from '@torsher/release-parser'
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
  followSeasons,
  metaCache,
  trackerEpisodes,
} from '../../db/schema.ts'
import { nextAired } from '../mine/newEpisodes.ts'
import { tvOngoing } from '../tmdb/fixtures/index.ts'
import { getSeason, getTitleSummary } from '../tmdb/index.ts'
import { decideFollow, followStates } from './pass.ts'
import {
  purgeTrackerEpisodes,
  recordTrackerEpisodes,
} from './trackerEpisodes.ts'
import { localDay } from './wanted.ts'

const SERIES = 'tmdb:tv:3100'
const GB = 1024 ** 3
const DAY_MS = 24 * 60 * 60 * 1000
const high: TitleMatch = { confidence: 'high', issues: [] }
const fetchMock = vi.fn<typeof fetch>()
// Серий во втором сезоне по TMDB: тест «TMDB узнал серию» его меняет
let season2Count = 5

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function day(offset: number) {
  return localDay(new Date(Date.now() + offset * DAY_MS))
}

// Второй сезон: по TMDB вышли все серии, новых не анонсировано
function series() {
  return {
    ...tvOngoing,
    id: 3100,
    name: 'Тихая гавань',
    original_name: 'Quiet Harbor',
    original_language: 'en',
    first_air_date: '2023-05-01',
    status: 'Returning Series',
    last_episode_to_air: {
      season_number: 2,
      episode_number: season2Count,
      air_date: day(-3),
    },
    next_episode_to_air: null,
    seasons: [
      {
        season_number: 1,
        name: 'Сезон 1',
        episode_count: 8,
        air_date: '2023-05-01',
      },
      {
        season_number: 2,
        name: 'Сезон 2',
        episode_count: season2Count,
        air_date: day(-40),
      },
    ],
  }
}

function season2() {
  return {
    season_number: 2,
    name: 'Сезон 2',
    episodes: Array.from({ length: season2Count }, (_, index) => ({
      episode_number: index + 1,
      name: `Серия ${index + 1}`,
      overview: 'Описание',
      air_date: day(-3 - (season2Count - 1 - index) * 7),
      runtime: 50,
    })),
  }
}

function found(title: string, extra: Partial<FoundRelease> = {}): FoundRelease {
  return {
    id: title,
    title,
    indexers: [{ id: 'ix', name: 'Indexer A' }],
    seeders: 20,
    size: 1.5 * GB,
    infoHash: 'c'.repeat(40),
    parsed: parseRelease(title),
    match: high,
    ...extra,
  }
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
      voiceStudio: 'LostFilm',
      requireRussian: false,
      waitHours: 24,
      ...values,
    })
    .returning()
    .get()
}

function trackerRows() {
  return getDb()
    .select({
      season: trackerEpisodes.season,
      episode: trackerEpisodes.episode,
    })
    .from(trackerEpisodes)
    .all()
    .sort((a, b) => a.season - b.season || a.episode - b.episode)
}

function tmdbPaths() {
  return fetchMock.mock.calls
    .map(([input]) => new URL(String(input)))
    .filter(url => url.hostname === 'api.themoviedb.org')
    .map(url => url.pathname)
}

beforeAll(async () => {
  await migrateDb()
})

beforeEach(() => {
  for (const table of [follows, trackerEpisodes, metaCache])
    getDb().delete(table).run()

  season2Count = 5
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input) => {
    const url = new URL(String(input))

    if (url.pathname === '/3/tv/3100')
      return json(series())

    if (url.pathname === '/3/tv/3100/season/2')
      return json(season2())

    return json({ status_message: 'not found' }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('TMDB_ACCESS_TOKEN', 'test-token')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('серии с трекера', () => {
  it('раздача S02E01-06 при пяти сериях в TMDB даёт шестую «на трекере», и она нужная', async () => {
    const follow = insertFollow()
    const now = new Date()

    await recordTrackerEpisodes(
      SERIES,
      [found('Quiet.Harbor.S02E01-06.1080p.WEB-DL')],
      now,
    )

    expect(trackerRows()).toEqual([{ season: 2, episode: 6 }])

    const summary = await getTitleSummary(SERIES, 'ru-RU')

    expect(summary?.details.seasons?.[1]).toMatchObject({
      number: 2,
      episodeCount: 6,
      airedEpisodeCount: 6,
    })
    expect(summary?.airing?.last).toMatchObject({
      season: 2,
      episode: 6,
      airDate: localDay(now),
    })

    const season = await getSeason(SERIES, 2, 'ru-RU')

    expect(season?.episodes).toHaveLength(6)
    expect(season?.episodes[5]).toEqual({
      number: 6,
      title: '',
      overview: '',
      tracker: true,
    })

    const states = await followStates(follow, now)

    expect(states.find(item => item.episode === 6)).toMatchObject({
      season: 2,
      state: 'searching',
    })
  })

  it('«Новые серии» и «Продолжить» видят серию с трекера вышедшей', async () => {
    await recordTrackerEpisodes(SERIES, [
      found(
        'Тихая гавань / Quiet Harbor / Сезон: 2 / Серии: 6 из 12 (2024) WEB-DL 1080p',
      ),
    ])

    const summary = await getTitleSummary(SERIES, 'ru-RU')
    const watched = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8]
        .map(episode => `1:${episode}`)
        .concat([1, 2, 3, 4, 5].map(episode => `2:${episode}`)),
    )

    expect(nextAired(summary!.details.seasons!, watched)).toEqual({
      season: 2,
      episode: 6,
      newCount: 1,
    })
  })

  it('«из 12» не создаёт серий, а запоминается подсказкой размера сезона', async () => {
    const follow = insertFollow()

    await recordTrackerEpisodes(SERIES, [
      found(
        'Тихая гавань / Quiet Harbor / Сезон: 2 / Серии: 1-5 из 12 (2024) WEB-DL 1080p',
      ),
      found(
        'Тихая гавань / Quiet Harbor / Сезон: 2 / Серии: 1-4 из 10 (2024) WEB-DL 720p',
      ),
    ])

    expect(trackerRows()).toEqual([])
    expect(
      getDb()
        .select({ expectedTotal: followSeasons.expectedTotal })
        .from(followSeasons)
        .where(
          and(
            eq(followSeasons.followId, follow.id),
            eq(followSeasons.season, 2),
          ),
        )
        .get(),
    ).toEqual({ expectedTotal: 12 })

    const summary = await getTitleSummary(SERIES, 'ru-RU')

    expect(summary?.details.seasons?.[1]?.episodeCount).toBe(5)
  })

  it('сезон, которого нет в TMDB, добавляется без запроса его в TMDB', async () => {
    await recordTrackerEpisodes(SERIES, [
      found(
        'Тихая гавань / Quiet Harbor / Сезон: 3 / Серии: 3-4 из 10 (2025) WEB-DL 1080p',
      ),
    ])

    expect(trackerRows()).toEqual([
      { season: 3, episode: 3 },
      { season: 3, episode: 4 },
    ])

    const summary = await getTitleSummary(SERIES, 'ru-RU')

    expect(summary?.details.seasons?.[2]).toEqual({
      number: 3,
      name: 'Сезон 3',
      episodeCount: 4,
      airedEpisodeCount: 4,
    })

    const season = await getSeason(SERIES, 3, 'ru-RU')

    // Раз вышла третья серия, вышли и первые две
    expect(season?.episodes.map(item => [item.number, item.tracker])).toEqual(
      [
        [1, true],
        [2, true],
        [3, true],
        [4, true],
      ],
    )
    expect(tmdbPaths()).not.toContain('/3/tv/3100/season/3')
  })

  it('не записывает неуверенные раздачи, раздачи без диапазона и сезоны не по порядку', async () => {
    await recordTrackerEpisodes(SERIES, [
      found(
        'Тихая гавань / Quiet Harbor / Сезон: 2 / Серии: 1-7 из 12 (2024) WEB-DL 1080p',
        {
          match: { confidence: 'medium', issues: [] },
        },
      ),
      found('Тихая гавань / Quiet Harbor / Сезон: 2 (2024) WEB-DL 1080p'),
      found(
        'Тихая гавань / Quiet Harbor / Сезон: 5 / Серии: 1-3 (2027) WEB-DL 1080p',
      ),
    ])

    expect(trackerRows()).toEqual([])
  })

  it('решатель видит серию с трекера нужной в той же раздаче', async () => {
    const follow = insertFollow()
    const now = new Date()

    await decideFollow(
      follow,
      [
        found(
          'Тихая гавань / Quiet Harbor / Сезон: 2 / Серии: 6 из 12 (2024) WEB-DL 1080p | HDRezka',
        ),
      ],
      now,
    )

    const row = getDb()
      .select()
      .from(followEpisodes)
      .where(
        and(
          eq(followEpisodes.followId, follow.id),
          eq(followEpisodes.season, 2),
          eq(followEpisodes.episode, 6),
        ),
      )
      .get()

    // Чужая студия ждёт окно: серия нужная, кандидат отложен
    expect(row?.pending?.title).toContain('HDRezka')
    expect(row?.waitUntil).toBeInstanceOf(Date)
  })

  it('ежедневная чистка удаляет серии, которые TMDB уже знает', async () => {
    await recordTrackerEpisodes(SERIES, [
      found('Quiet.Harbor.S02E01-07.1080p.WEB-DL'),
    ])

    expect(trackerRows()).toEqual([
      { season: 2, episode: 6 },
      { season: 2, episode: 7 },
    ])

    // TMDB узнал шестую серию
    season2Count = 6
    getDb().delete(metaCache).run()

    const season = await getSeason(SERIES, 2, 'ru-RU')

    expect(season?.episodes.map(item => !!item.tracker)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      true,
    ])

    await purgeTrackerEpisodes()

    expect(trackerRows()).toEqual([{ season: 2, episode: 7 }])
  })
})
