import type { TitleAlias } from '../../db/schema.ts'
import type { SearchableIndexer } from '../indexers/index.ts'
import type { TitleIdentity } from '../tmdb/index.ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { searchXml } from '../torznab/fixtures/index.ts'
import { mergeHits, searchReleases } from './search.ts'

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function indexer(id: string, host: string): SearchableIndexer {
  return {
    id,
    name: `Indexer ${id}`,
    url: `https://${host}/torznab`,
    caps: {
      search: { available: true, params: ['q'] },
      tvSearch: { available: false, params: [] },
      movieSearch: { available: false, params: [] },
      categories: [],
    },
    apiKey: () => undefined,
  }
}

const identity: TitleIdentity = {
  kind: 'series',
  tmdbId: 101,
  year: 2023,
  names: [{ value: 'Quiet Harbor', lang: 'en', kind: 'original' }],
}

const aliases: TitleAlias[] = [
  {
    titleId: 'tmdb:tv:101',
    value: 'Quiet Harbor',
    normalized: 'quietharbor',
    lang: 'en',
    kind: 'original',
    syncedAt: new Date(0),
  },
]

describe('searchReleases', () => {
  it('индексатор, не ответивший к сроку, — timeout; остальное приходит', async () => {
    fetchMock.mockImplementation(async (input) => {
      if (String(input).includes('slow.indexer.example'))
        return new Promise<Response>(() => {})

      return new Response(searchXml)
    })

    const outcome = await searchReleases(
      { identity, aliases, season: 2 },
      [
        indexer('a', 'a.indexer.example'),
        indexer('slow', 'slow.indexer.example'),
      ],
      { deadlineMs: 50 },
    )

    expect(outcome.failed).toEqual([
      { id: 'slow', name: 'Indexer slow', kind: 'timeout' },
    ])
    expect(outcome.releases.map(release => release.seeders)).toEqual([42, 7])
    expect(outcome.indexerCount).toBe(2)
  })

  it('индексатор без поиска текстом и по ID — unsupported', async () => {
    const mute = {
      ...indexer('mute', 'mute.indexer.example'),
      caps: {
        search: { available: false, params: [] },
        tvSearch: { available: false, params: [] },
        movieSearch: { available: false, params: [] },
        categories: [],
      },
    }
    const outcome = await searchReleases({ identity, aliases, season: 2 }, [
      mute,
    ])

    expect(outcome.failed).toEqual([
      { id: 'mute', name: 'Indexer mute', kind: 'unsupported' },
    ])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('строка зрителя: один текстовый запрос, раздача под этим названием не отсекается', async () => {
    fetchMock.mockResolvedValue(
      new Response(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed">
  <channel>
    <item>
      <title>Harbour Tales S02 1080p WEB-DL</title>
      <torznab:attr name="seeders" value="3" />
      <torznab:attr name="infohash" value="${'4'.repeat(40)}" />
    </item>
  </channel>
</rss>`),
    )

    const withIds = {
      ...indexer('a', 'a.indexer.example'),
      caps: {
        ...indexer('a', 'a.indexer.example').caps,
        tvSearch: { available: true, params: ['q', 'tmdbid'] },
      },
    }
    const outcome = await searchReleases(
      { identity, aliases, season: 2, query: ' Harbour Tales 2023 ' },
      [withIds],
    )
    const urls = fetchMock.mock.calls.map(([input]) => new URL(String(input)))

    expect(
      urls.map(url => [url.searchParams.get('t'), url.searchParams.get('q')]),
    ).toEqual([['search', 'Harbour Tales 2023']])
    expect(outcome.releases.map(release => release.title)).toEqual([
      'Harbour Tales S02 1080p WEB-DL',
    ])
  })

  it('без строки зрителя чужое название отсекается', async () => {
    fetchMock.mockResolvedValue(
      new Response(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><item><title>Harbour Tales S02 1080p WEB-DL</title></item></channel></rss>`),
    )

    const outcome = await searchReleases({ identity, aliases, season: 2 }, [
      indexer('a', 'a.indexer.example'),
    ])

    expect(outcome.releases).toEqual([])
  })
})

describe('mergeHits', () => {
  it('склеивает раздачу по infohash из magnet и берёт больше сидов', () => {
    const hash = '3'.repeat(40)
    const merged = mergeHits([
      {
        indexer: indexer('a', 'a.indexer.example'),
        release: {
          title: 'Quiet Harbor S02',
          infoHash: hash,
          link: 'https://a.indexer.example/download/1',
          seeders: 5,
          categories: [],
        },
      },
      {
        indexer: indexer('b', 'b.indexer.example'),
        release: {
          title: 'Тихая гавань / Сезон 2',
          magnet: `magnet:?xt=urn:btih:${hash}`,
          seeders: 9,
          size: 100,
          categories: [],
        },
      },
    ])

    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({
      title: 'Quiet Harbor S02',
      seeders: 9,
      size: 100,
      infoHash: hash,
      magnet: `magnet:?xt=urn:btih:${hash}`,
      link: {
        url: 'https://a.indexer.example/download/1',
        indexerId: 'a',
        indexerOrigin: 'https://a.indexer.example',
      },
      indexers: [
        { id: 'a', name: 'Indexer a' },
        { id: 'b', name: 'Indexer b' },
      ],
    })
  })
})
