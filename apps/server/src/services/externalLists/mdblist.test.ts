import { afterEach, expect, it, vi } from 'vitest'
import { readMdblist, sourcePath } from './mdblist.ts'

const fetchMock = vi.fn<typeof fetch>()
const request = {
  key: 'synthetic',
  signal: new AbortController().signal,
  beforeRequest: () => {},
  onResponse: () => {},
}

function json(value: unknown, headers?: Record<string, string>) {
  return new Response(JSON.stringify(value), { headers })
}

afterEach(() => {
  fetchMock.mockReset()
  vi.unstubAllGlobals()
})

it('accepts only numeric IDs and ordinary MDBList URLs as identifiers', () => {
  expect(sourcePath('0022')).toBe('/lists/22')
  expect(sourcePath('https://mdblist.com/lists/viewer/list-name/')).toBe(
    '/lists/viewer/list-name',
  )
  for (const source of [
    '0',
    '9007199254740993',
    'https://example.test/lists/viewer/list',
    'https://mdblist.com/lists/x/../viewer/list',
    'https://mdblist.com/lists/viewer/%252fetc',
    'https://mdblist.com/lists/viewer/%2e',
    'https://mdblist.com/lists/viewer/list?apikey=x',
    'https://mdblist.com/lists/viewer/list#',
    'https://mdblist.com/lists/viewer/list/json',
    'https://mdblist.com/lists/%73hare/shared-token',
    'https://mdblist.com/lists/Official/ranking',
    'https://mdblist.com/lists/user/8000',
    'https://mdblist.com/lists/recommended/rising',
    'https://mdblist.com/lists/123/items',
    'https://mdblist.com/lists/123/%63hanges',
  ]) {
    expect(() => sourcePath(source)).toThrow('invalidSource')
  }
})

it('uses the fixed API origin and checks continuation across typed buckets', async () => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock
    .mockResolvedValueOnce(
      json({ id: 11, private: false, name: 'Example', items: 3 }),
    )
    .mockResolvedValueOnce(
      json(
        {
          movies: [{ id: 1, ids: { tmdb: 1, imdb: 'tt0115000' }, rank: 2 }],
          shows: [{ id: 1, mediatype: 'show', rank: 1 }],
          pagination: { next_cursor: 'opaque +/=&' },
        },
        { 'X-Has-More': 'true' },
      ),
    )
    .mockResolvedValueOnce(
      json({ episodes: [{}], pagination: { next_cursor: null } }),
    )

  const snapshot = await readMdblist(
    request,
    'https://mdblist.com/lists/owner/list',
  )
  expect(snapshot).toEqual({
    id: 11,
    name: 'Example',
    items: [
      { type: 'movie', tmdbId: 1, imdbId: 'tt0115000', rank: 2 },
      { type: 'tv', tmdbId: 1, rank: 1 },
      undefined,
    ],
  })
  const calls = fetchMock.mock.calls.map(([url]) => new URL(String(url)))
  expect(calls.map(url => url.origin)).toEqual(
    Array.from({ length: 3 }).fill('https://api.mdblist.com'),
  )
  expect(calls.map(url => url.pathname)).toEqual([
    '/lists/owner/list',
    '/lists/11/items',
    '/lists/11/items',
  ])
  expect(calls[2]?.searchParams.get('cursor')).toBe('opaque +/=&')
  expect(calls[2]?.searchParams.get('apikey')).toBe('synthetic')
})

it('rejects a private list and does not follow redirects', async () => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockResolvedValueOnce(
    json({ id: 11, private: true, name: 'Private' }),
  )
  await expect(readMdblist(request, 11)).rejects.toThrow('sourceUnavailable')
  fetchMock.mockResolvedValueOnce(
    new Response('', {
      status: 302,
      headers: { Location: 'http://127.0.0.1/internal?apikey=synthetic' },
    }),
  )
  await expect(readMdblist(request, 11)).rejects.toThrow('providerError')
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

it('accepts exact 500 but rejects declared overflow or a lost cursor', async () => {
  vi.stubGlobal('fetch', fetchMock)
  const movies = Array.from({ length: 100 }, (_, index) => ({ id: index + 1 }))
  for (const extraCursor of [false, true]) {
    fetchMock.mockResolvedValueOnce(
      json({ id: 11, private: false, name: 'Example' }),
    )
    for (let index = 0; index < 5; index++) {
      const cursor = index < 4 || extraCursor ? String(index) : null
      fetchMock.mockResolvedValueOnce(json({ movies, next_cursor: cursor }))
    }
    const result = readMdblist(request, 11)
    if (extraCursor)
      await expect(result).rejects.toThrow('sourceTooLarge')
    else expect((await result).items).toHaveLength(500)
  }
  fetchMock
    .mockResolvedValueOnce(json({ id: 11, private: false, name: 'Example' }))
    .mockResolvedValueOnce(json({ movies }, { 'X-Has-More': 'true' }))
  await expect(readMdblist(request, 11)).rejects.toThrow('providerError')
})

it('rejects ambiguous source metadata, malformed bodies and looping cursors', async () => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockResolvedValueOnce(json([{ id: 11 }, { id: 12 }]))
  await expect(
    readMdblist(request, 'https://mdblist.com/lists/owner/list'),
  ).rejects.toThrow('sourceAmbiguous')
  for (const body of [
    { wrong: [] },
    { movies: [], next_cursor: 'loop' },
    {
      movies: [{ id: 1 }],
      next_cursor: 'loop',
      pagination: { next_cursor: null },
    },
  ]) {
    fetchMock
      .mockResolvedValueOnce(json({ id: 11, private: false, name: 'Example' }))
      .mockResolvedValueOnce(json({ shows: [{ id: 42 }], next_cursor: 'loop' }))
      .mockResolvedValueOnce(json(body))
    await expect(readMdblist(request, 11)).rejects.toThrow('providerError')
  }
})

it('requires end-of-list evidence on a full page and reconciles both totals', async () => {
  vi.stubGlobal('fetch', fetchMock)
  const movies = Array.from({ length: 100 }, (_, index) => ({ id: index + 1 }))

  for (const [metadata, body, headers] of [
    [{}, { movies, next_cursor: null }, {}],
    [{}, { movies }, { 'X-Has-More': 'false' }],
    [{ items: 100 }, { movies }, {}],
    [{}, { movies, pagination: { total: 100 } }, {}],
  ] as const) {
    fetchMock
      .mockResolvedValueOnce(
        json({ id: 11, private: false, name: 'Example', ...metadata }),
      )
      .mockResolvedValueOnce(json(body, headers))
    expect((await readMdblist(request, 11)).items).toHaveLength(100)
  }

  for (const [metadata, body] of [
    [{}, { movies }],
    [{ items: 110 }, { movies, pagination: { next_cursor: null, total: 100 } }],
    [{ items: 90 }, { movies, next_cursor: null }],
  ] as const) {
    fetchMock
      .mockResolvedValueOnce(
        json({ id: 11, private: false, name: 'Example', ...metadata }),
      )
      .mockResolvedValueOnce(json(body))
    await expect(readMdblist(request, 11)).rejects.toThrow('providerError')
  }
})

it('accepts documented empty pages, including an explicit zero total', async () => {
  vi.stubGlobal('fetch', fetchMock)
  for (const body of [
    { movies: [], shows: [] },
    { pagination: { total: 0 } },
  ]) {
    fetchMock
      .mockResolvedValueOnce(
        json({ id: 11, private: false, name: 'Example', items: 0 }),
      )
      .mockResolvedValueOnce(json(body))
    expect((await readMdblist(request, 11)).items).toEqual([])
  }
})
