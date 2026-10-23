import type { Card } from '../../dto/catalog.ts'
import type { RatingProvider } from './index.ts'
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
import { serverSettings, titleExternalIds } from '../../db/schema.ts'
import { TMDB_MAX_CACHE_AGE_MS } from '../tmdb/cache.ts'
import {
  imdbIdQueueIdle,
  knownImdbIds,
  rememberImdbId,
} from './externalIds.ts'
import { setImdbEnabled } from './imdb/state.ts'
import * as store from './imdb/store.ts'
import {
  collectRatings,
  purgeExpiredExternalIds,
  registerRatingProvider,
  unregisterRatingProvider,
  withRatings,
} from './index.ts'

const fetchMock = vi.fn<typeof fetch>()

function card(id: string, tmdb?: number): Card {
  return {
    id,
    kind: id.includes(':tv:') ? 'series' : 'movie',
    title: id,
    originalTitle: id,
    ratings:
      tmdb === undefined
        ? undefined
        : [{ provider: 'tmdb', label: 'TMDB', value: tmdb, votes: 10 }],
  }
}

function plugin(overrides: Partial<RatingProvider>): RatingProvider {
  return {
    id: 'plugin',
    label: 'Plugin',
    enabled: () => true,
    ratingsFor: async refs =>
      new Map(refs.map(ref => [ref.key, { value: 7 }])),
    ...overrides,
  }
}

beforeAll(() => {
  migrateDb()
})

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('TMDB_ACCESS_TOKEN', 'test-token')
  getDb().delete(serverSettings).run()
  getDb().delete(titleExternalIds).run()
})

afterEach(() => {
  unregisterRatingProvider('plugin')
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('collectRatings', () => {
  it('отдаёт оценки в порядке реестра: TMDB, IMDb, плагины', async () => {
    setImdbEnabled(true)
    vi.spyOn(store, 'lookupImdbRatings').mockReturnValue(
      new Map([['tt0000101', { value: 8.1, votes: 500 }]]),
    )
    registerRatingProvider(plugin({}))

    const ratings = await collectRatings([
      {
        key: 'a',
        kind: 'movie',
        tmdbId: 1,
        imdbId: 'tt0000101',
        title: 'A',
        originalTitle: 'A',
        tmdbVote: { value: 7.8, votes: 20 },
      },
    ])

    expect(ratings.get('a')).toEqual([
      { provider: 'tmdb', label: 'TMDB', value: 7.8, votes: 20 },
      { provider: 'imdb', label: 'IMDb', value: 8.1, votes: 500 },
      { provider: 'plugin', label: 'Plugin', value: 7, votes: undefined },
    ])
  })

  it('пропускает упавшего, медленного и выключенного поставщика', async () => {
    registerRatingProvider(
      plugin({ ratingsFor: () => Promise.reject(new Error('down')) }),
    )
    registerRatingProvider(
      plugin({
        id: 'slow',
        timeoutMs: 20,
        ratingsFor: () => new Promise(() => {}),
      }),
    )

    const ratings = await collectRatings([
      { key: 'a', kind: 'movie', tmdbId: 1, title: 'A', originalTitle: 'A' },
    ])

    unregisterRatingProvider('slow')

    expect(ratings.get('a')).toEqual([])
  })
})

describe('withRatings', () => {
  it('без IMDb оставляет оценку TMDB и не трогает очередь', async () => {
    const cards = await withRatings([
      card('tmdb:movie:1', 7.5),
      card('tmdb:movie:2'),
    ])

    expect(cards[0]!.ratings).toEqual([
      { provider: 'tmdb', label: 'TMDB', value: 7.5, votes: 10 },
    ])
    expect(cards[1]!.ratings).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('берёт известный IMDb ID, неизвестные ставит в очередь без повторов', async () => {
    setImdbEnabled(true)
    rememberImdbId({ type: 'movie', tmdbId: 1 }, 'tt0000101')
    vi.spyOn(store, 'lookupImdbRatings').mockImplementation(
      ids =>
        new Map(
          ids.includes('tt0000101')
            ? [['tt0000101', { value: 8.1, votes: 500 }]]
            : [],
        ),
    )
    fetchMock.mockImplementation(async () =>
      Response.json({ imdb_id: 'tt0000202' }),
    )

    const cards = await withRatings([
      card('tmdb:movie:1'),
      card('tmdb:tv:2'),
      card('tmdb:tv:2'),
    ])

    expect(cards[0]!.ratings).toEqual([
      { provider: 'imdb', label: 'IMDb', value: 8.1, votes: 500 },
    ])
    expect(cards[1]!.ratings).toBeUndefined()

    await imdbIdQueueIdle()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(new URL(String(fetchMock.mock.calls[0]![0])).pathname).toBe(
      '/3/tv/2/external_ids',
    )
    expect(knownImdbIds([{ type: 'tv', tmdbId: 2 }]).get('tv:2')).toBe(
      'tt0000202',
    )
  })
})

describe('соответствия TMDB → IMDb', () => {
  it('помнит отсутствие IMDb ID и удаляет записи у предела TMDB', () => {
    const now = Date.now()

    rememberImdbId({ type: 'movie', tmdbId: 3 }, null)
    expect(
      knownImdbIds([{ type: 'movie', tmdbId: 3 }]).get('movie:3'),
    ).toBeNull()

    expect(purgeExpiredExternalIds(now + TMDB_MAX_CACHE_AGE_MS)).toBe(1)
    expect(knownImdbIds([{ type: 'movie', tmdbId: 3 }]).size).toBe(0)
  })
})
