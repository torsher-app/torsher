import type { TorznabCaps } from './caps.ts'
import type { SearchQuery } from './search.ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SourceError } from './client.ts'
import {
  emptySearchXml,
  searchXml,
  torznabErrorXml,
} from './fixtures/index.ts'
import { buildSearchRequests, searchIndexer } from './search.ts'

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function capsWith(overrides: Partial<TorznabCaps> = {}): TorznabCaps {
  return {
    search: { available: true, params: ['q'] },
    tvSearch: { available: true, params: ['q', 'season', 'ep'] },
    movieSearch: { available: true, params: ['q'] },
    categories: [
      { id: 2000, name: 'Movies', subcategories: [] },
      { id: 5000, name: 'TV', subcategories: [] },
    ],
    ...overrides,
  }
}

const series: SearchQuery = {
  kind: 'series',
  ids: { imdb: 'tt0000001', tmdb: 101, tvdb: 202 },
  titles: ['Тихая гавань', 'Quiet Harbor'],
  year: 2023,
  season: 2,
}

const movie: SearchQuery = {
  kind: 'movie',
  ids: { imdb: 'tt0000002', tmdb: 303 },
  titles: ['Бумажный фонарь'],
  year: 2021,
}

describe('buildSearchRequests', () => {
  it('без ID-параметров в caps ищет только текстом', () => {
    expect(buildSearchRequests(capsWith(), series)).toEqual([
      { t: 'search', q: 'Тихая гавань', cat: '5000' },
      { t: 'search', q: 'Quiet Harbor', cat: '5000' },
    ])
  })

  it('сериал: tvdbid с сезоном раньше imdbid', () => {
    const caps = capsWith({
      tvSearch: {
        available: true,
        params: ['q', 'season', 'imdbid', 'tvdbid'],
      },
    })

    expect(buildSearchRequests(caps, series)[0]).toEqual({
      t: 'tvsearch',
      tvdbid: '202',
      season: '2',
      cat: '5000',
    })
  })

  it('сериал: imdbid с префиксом, если tvdbid не поддержан', () => {
    const caps = capsWith({
      tvSearch: { available: true, params: ['q', 'imdbid'] },
    })

    expect(buildSearchRequests(caps, series)[0]).toEqual({
      t: 'tvsearch',
      imdbid: 'tt0000001',
      cat: '5000',
    })
  })

  it('фильм: tmdbid, затем imdbid без tt; год в тексте', () => {
    expect(
      buildSearchRequests(
        capsWith({
          movieSearch: { available: true, params: ['q', 'tmdbid', 'imdbid'] },
        }),
        movie,
      ),
    ).toEqual([
      { t: 'movie', tmdbid: '303', cat: '2000' },
      { t: 'search', q: 'Бумажный фонарь 2021', cat: '2000' },
    ])

    expect(
      buildSearchRequests(
        capsWith({ movieSearch: { available: true, params: ['imdbid'] } }),
        movie,
      )[0],
    ).toEqual({ t: 'movie', imdbid: '0000002', cat: '2000' })
  })

  it('категорию не передаёт, если её нет в caps; без поиска текстом — пусто', () => {
    const caps = capsWith({
      search: { available: false, params: [] },
      categories: [],
    })

    expect(buildSearchRequests(caps, series)).toEqual([])
    expect(
      buildSearchRequests(
        { ...caps, search: { available: true, params: [] } },
        movie,
      ),
    ).toEqual([{ t: 'search', q: 'Бумажный фонарь 2021' }])
  })
})

describe('searchIndexer', () => {
  it('разбирает раздачи и атрибуты Torznab', async () => {
    fetchMock.mockResolvedValue(new Response(searchXml))

    const releases = await searchIndexer(
      'https://indexer.example/torznab',
      { t: 'search', q: 'Quiet Harbor' },
      'secret-key',
    )
    const url = new URL(String(fetchMock.mock.calls[0]![0]))

    expect(url.searchParams.get('extended')).toBe('1')
    expect(url.searchParams.get('apikey')).toBe('secret-key')
    expect(releases).toEqual([
      {
        title:
          'Тихая гавань / Quiet Harbor / Сезон: 2 / Серии: 1-8 из 8 (2024) WEB-DL 1080p | LostFilm',
        guid: 'https://indexer.example/details/101',
        link: 'https://indexer.example/download/101?apikey=secret-key',
        magnet: undefined,
        infoHash: '1111111111111111111111111111111111111111',
        size: 16106127360,
        seeders: 42,
        peers: 50,
        publishedAt: new Date('2024-10-14T18:00:00Z'),
        categories: [5000, 5040],
      },
      {
        title: 'Quiet.Harbor.S02E05.2160p.WEB-DL.DV.H.265-GRP',
        guid: 'quiet-harbor-s02e05',
        link: undefined,
        magnet:
          'magnet:?xt=urn:btih:2222222222222222222222222222222222222222&dn=Quiet.Harbor.S02E05',
        infoHash: undefined,
        size: 5368709120,
        seeders: 7,
        peers: undefined,
        publishedAt: undefined,
        categories: [5000, 5045],
      },
    ])
  })

  it('пустой канал — пустой список', async () => {
    fetchMock.mockResolvedValue(new Response(emptySearchXml))

    await expect(
      searchIndexer('https://indexer.example/torznab', { t: 'search', q: 'x' }),
    ).resolves.toEqual([])
  })

  it('ошибка Torznab в теле — SourceError', async () => {
    fetchMock.mockImplementation(
      async () => new Response(torznabErrorXml(100, 'Bad key')),
    )

    await expect(
      searchIndexer('https://indexer.example/torznab', { t: 'search', q: 'x' }),
    ).rejects.toMatchObject({ kind: 'auth' })
    await expect(
      searchIndexer('https://indexer.example/torznab', { t: 'search', q: 'x' }),
    ).rejects.toBeInstanceOf(SourceError)
  })
})
