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

  it('медленные индексаторы не занимают все потоки: остальные успевают', async () => {
    fetchMock.mockImplementation(async (input) => {
      if (String(input).includes('slow'))
        return new Promise<Response>(() => {})

      return new Response(searchXml)
    })

    const titles = ['Quiet Harbor', 'Silent Harbor', 'Calm Harbor']
    const outcome = await searchReleases(
      {
        identity,
        aliases: titles.map(value => ({ ...aliases[0]!, value })),
        season: 2,
      },
      [
        indexer('slow-1', 'slow-1.indexer.example'),
        indexer('slow-2', 'slow-2.indexer.example'),
        indexer('a', 'a.indexer.example'),
      ],
      { deadlineMs: 50, concurrency: 3 },
    )

    expect(outcome.failed.map(item => item.id)).toEqual(['slow-1', 'slow-2'])
    expect(outcome.releases.length).toBeGreaterThan(0)
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

describe('несопоставленные результаты', () => {
  it.each([undefined, 'Quiet Harbor'])(
    'автоматический поиск отсекает шум, ручной сохраняет исходные low: %s',
    async (query) => {
      const keep = [
        'Label: Quiet Harbor (2023) WEBRip',
        'Label: Quiet Harbor WEBRip',
      ]
      const noise = [
        'Label: Quiet Harbors (2023) WEBRip',
        'Label: Quiet Other Harbor (2023) WEBRip',
        'Label: Unquiet Harbor (2023) WEBRip',
        'Label: Quiet Harbor (2010) WEBRip',
        'Label: Quiet Harbor (2026) WEBRip',
      ]
      const titles = [...keep, ...noise]
      fetchMock.mockImplementation(
        async () =>
          new Response(
            `<rss><channel>${titles.map(title => `<item><title>${title}</title></item>`).join('')}</channel></rss>`,
          ),
      )
      const result = await searchReleases(
        { identity: { ...identity, endYear: 2024 }, aliases, season: 1, query },
        [indexer('a', 'a.indexer.example')],
      )
      expect(result.releases).toEqual([])
      expect(result.unmatched.map(item => item.title)).toEqual(
        query ? titles : keep,
      )
      expect(
        result.unmatched.every(item => item.match.confidence === 'low'),
      ).toBe(true)
    },
  )

  it('точный запрос находит старый сериал, запрос без года сохраняет поздний сезон', async () => {
    fetchMock.mockImplementation(async (input) => {
      const q = new URL(String(input)).searchParams.get('q')
      const title
        = q === 'Quiet Harbor 2023'
          ? 'Channel: Quiet Harbor (2023) DVDRip'
          : 'Quiet Harbor S03 (2025) WEBRip'
      return new Response(
        `<rss><channel><item><title>${title}</title></item></channel></rss>`,
      )
    })
    const result = await searchReleases(
      { identity, aliases },
      [indexer('a', 'a.indexer.example')],
      { seriesYearQuery: true },
    )
    expect(
      fetchMock.mock.calls.map(([input]) =>
        new URL(String(input)).searchParams.get('q'),
      ),
    ).toEqual(['Quiet Harbor 2023', 'Quiet Harbor'])
    expect(result.releases.map(item => item.title)).toEqual([
      'Channel: Quiet Harbor (2023) DVDRip',
      'Quiet Harbor S03 (2025) WEBRip',
    ])
    expect(
      result.releases.every(item => item.match.confidence === 'medium'),
    ).toBe(true)
    expect(result.unmatched).toEqual([])
  })

  it.each([
    { kind: 'movie' as const, endYear: undefined, years: [2022, 2023, 2024] },
    { kind: 'series' as const, endYear: 2024, years: [2022, 2023, 2024, 2025] },
    {
      kind: 'series' as const,
      endYear: undefined,
      years: [2022, 2023, 2024, 2025, 2026],
    },
  ])(
    'допуск года для $kind с endYear=$endYear',
    async ({ kind, endYear, years }) => {
      const all = [2021, 2022, 2023, 2024, 2025, 2026]
      fetchMock.mockImplementation(
        async () =>
          new Response(
            `<rss><channel>${all.map(year => `<item><title>Label: Quiet Harbor (${year}) WEBRip</title></item>`).join('')}</channel></rss>`,
          ),
      )
      const result = await searchReleases(
        { identity: { ...identity, kind, endYear }, aliases },
        [indexer('a', 'a.indexer.example')],
      )
      expect(
        [...result.releases, ...result.unmatched]
          .map(item => item.parsed.year)
          .sort(),
      ).toEqual(years)
      expect(result.releases.map(item => item.parsed.year)).toEqual([
        2022,
        2023,
        2024,
      ])
      expect(
        result.releases.every(item => item.match.confidence === 'medium'),
      ).toBe(true)
    },
  )

  it.each([undefined, 'Quiet Harbor'])(
    'сохраняет произвольные префиксы при query=%s',
    async (query) => {
      const titles = [
        'Channel One: Quiet Harbor (2023) DVDRip',
        'Studio Two. Quiet Harbor [01-08 из 08] (2023) WEBRip',
      ]
      fetchMock.mockImplementation(
        async () =>
          new Response(
            `<rss><channel>${titles.map(title => `<item><title>${title}</title></item>`).join('')}</channel></rss>`,
          ),
      )
      const result = await searchReleases(
        { identity, aliases, season: 1, query },
        [indexer('a', 'a.indexer.example')],
      )
      expect(result.releases.map(item => item.title)).toEqual([titles[1]])
      expect(result.releases[0]?.match).toEqual({
        confidence: 'medium',
        issues: ['prefixedTitle'],
      })
      expect(result.unmatched.map(item => item.title)).toEqual([titles[0]])
      expect(result.unmatched[0]?.match).toEqual({
        confidence: 'low',
        issues: ['prefixedTitle', 'noSeason'],
      })
    },
  )

  it('лимит сначала заполняется совпадениями, шум с большим числом сидов их не вытесняет', async () => {
    const noise = Array.from(
      { length: 160 },
      (_, i) =>
        `<item><title>Channel ${i}: Quiet Harbor (2023) WEBRip</title><torznab:attr name="seeders" value="999" /></item>`,
    ).join('')
    fetchMock.mockImplementation(
      async () =>
        new Response(
          `<rss xmlns:torznab="http://torznab.com/schemas/2015/feed"><channel>${noise}<item><title>Quiet Harbor S01 (2023) WEBRip</title></item></channel></rss>`,
        ),
    )
    const result = await searchReleases({ identity, aliases, season: 1 }, [
      indexer('a', 'a.indexer.example'),
    ])
    expect(result.releases).toHaveLength(1)
    expect(result.releases[0]?.match.confidence).toBe('high')
    expect(result.unmatched).toHaveLength(149)
  })

  it('пустой ответ оставляет обе группы пустыми', async () => {
    fetchMock.mockImplementation(
      async () => new Response('<rss><channel /></rss>'),
    )
    const result = await searchReleases({ identity, aliases }, [
      indexer('a', 'a.indexer.example'),
    ])
    expect(result.releases).toEqual([])
    expect(result.unmatched).toEqual([])
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

describe('безопасность сопоставления', () => {
  it.each([undefined, 'Lift'])(
    'сопутствующий контент и короткие подстроки, query=%s',
    async (query) => {
      const titles = [
        'Lift (2023) WEB-DL',
        'Lift (2023) PC',
        'Lift (2023) OST FLAC',
        'Lift (2022) WEBRip | Trailer',
        'Lift in the Sky (2023) WEBRip',
        'We Lift Together (2023) WEBRip',
        'Channel: Lift (2023) WEBRip',
      ]
      fetchMock.mockImplementation(
        async () =>
          new Response(
            `<rss><channel>${titles.map(title => `<item><title>${title}</title></item>`).join('')}</channel></rss>`,
          ),
      )
      const result = await searchReleases(
        {
          identity: { ...identity, kind: 'movie' },
          aliases: [{ ...aliases[0]!, value: 'Lift' }],
          query,
        },
        [indexer('a', 'a.indexer.example')],
      )
      // Длинное продолжение названия — medium матчера; короткий алиас ниже проверяется отдельно.
      expect(
        result.releases
          .filter(item => item.match.confidence === 'high')
          .map(item => item.title),
      ).toEqual([titles[0]])
      expect(result.unmatched.map(item => item.title)).toEqual(
        query ? titles.slice(1, 6).filter(title => title !== titles[4]) : [],
      )
    },
  )

  it('двухбуквенный алиас не совпадает с произвольной частью названия', async () => {
    const titles = [
      'Ax in the Sky (2023) WEBRip',
      'We Ax Together (2023) WEBRip',
      'Channel: Ax (2023) WEBRip',
    ]
    fetchMock.mockImplementation(
      async () =>
        new Response(
          `<rss><channel>${titles.map(title => `<item><title>${title}</title></item>`).join('')}</channel></rss>`,
        ),
    )
    const result = await searchReleases(
      {
        identity: { ...identity, kind: 'movie' },
        aliases: [{ ...aliases[0]!, value: 'Ax' }],
      },
      [indexer('a', 'a.indexer.example')],
    )
    expect(result.releases.map(item => item.title)).toEqual([titles[2]])
    expect(result.releases[0]?.match).toEqual({
      confidence: 'medium',
      issues: ['prefixedTitle'],
    })
    expect(result.unmatched).toEqual([])
  })

  it('передаёт сезонные годы в матчер для паков и поздних сезонов', async () => {
    const titles = [
      'Quiet Harbor S01-S02 (2023) WEBRip',
      'Quiet Harbor S02 (2023) WEBRip',
      'Quiet Harbor S20 (2023) WEBRip',
    ]
    fetchMock.mockImplementation(
      async () =>
        new Response(
          `<rss><channel>${titles.map(title => `<item><title>${title}</title></item>`).join('')}</channel></rss>`,
        ),
    )
    const result = await searchReleases(
      {
        identity: {
          ...identity,
          year: 1999,
          seasonYears: { 1: 1999, 2: 2001, 3: 2003, 20: 2023 },
        },
        aliases,
      },
      [indexer('a', 'a.indexer.example')],
    )
    expect(result.releases.map(item => item.match.confidence)).toEqual([
      'medium',
      'medium',
      'high',
    ])
  })
})

it('префикс сохраняет полное название с внутренним двоеточием', async () => {
  const title = 'Channel: Quiet Harbor: Return (2023) WEBRip'
  fetchMock.mockImplementation(
    async () =>
      new Response(
        `<rss><channel><item><title>${title}</title></item></channel></rss>`,
      ),
  )
  const result = await searchReleases(
    { identity, aliases: [{ ...aliases[0]!, value: 'Quiet Harbor: Return' }] },
    [indexer('a', 'a.indexer.example')],
  )
  expect(result.releases.map(item => item.title)).toEqual([title])
  expect(result.releases[0]?.match).toEqual({
    confidence: 'medium',
    issues: ['prefixedTitle'],
  })
  expect(result.unmatched).toEqual([])
})

it.each([undefined, 'Quiet Harbor'])(
  'making-of не входит в автоматические результаты, ручной сохраняет low: %s',
  async (query) => {
    const title = 'Making Of: Quiet Harbor / Quiet Harbor (2023) WEBRip'
    fetchMock.mockImplementation(
      async () =>
        new Response(
          `<rss><channel><item><title>${title}</title></item></channel></rss>`,
        ),
    )
    const result = await searchReleases({ identity, aliases, query }, [
      indexer('a', 'a.indexer.example'),
    ])
    expect(result.releases).toEqual([])
    expect(result.unmatched.map(item => item.title)).toEqual(
      query ? [title] : [],
    )
  },
)
