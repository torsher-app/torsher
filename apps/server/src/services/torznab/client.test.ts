import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchCaps,
  normalizeTorznabUrl,
  SourceError,
  torznabRequestUrl,
} from './client.ts'
import { capsXml, torznabErrorXml } from './fixtures/index.ts'

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function kindOf(promise: Promise<unknown>) {
  try {
    await promise
  }
  catch (err) {
    expect(err).toBeInstanceOf(SourceError)

    return (err as SourceError).kind
  }

  throw new Error('Expected a SourceError')
}

describe('normalizeTorznabUrl', () => {
  it.each([
    ['https://indexer.example/torznab/', 'https://indexer.example/torznab'],
    ['https://indexer.example/torznab/api', 'https://indexer.example/torznab'],
    [
      'https://indexer.example/torznab/api/?apikey=x',
      'https://indexer.example/torznab',
    ],
    ['http://10.0.0.2:9696/1/', 'http://10.0.0.2:9696/1'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeTorznabUrl(input)).toBe(expected)
  })

  it('добавляет /api и ключ в запрос', () => {
    const url = torznabRequestUrl(
      'https://indexer.example/t/',
      { t: 'caps' },
      'key',
    )

    expect(url.href).toBe('https://indexer.example/t/api?t=caps&apikey=key')
  })
})

describe('fetchCaps', () => {
  it('разбирает режимы поиска и категории', async () => {
    fetchMock.mockResolvedValue(new Response(capsXml))

    const caps = await fetchCaps('https://indexer.example/torznab', 'key')

    expect(caps.search).toEqual({ available: true, params: ['q'] })
    expect(caps.tvSearch).toEqual({
      available: true,
      params: ['q', 'season', 'ep', 'imdbid'],
    })
    expect(caps.movieSearch.available).toBe(false)
    expect(caps.limits).toEqual({ max: 100, default: 50 })
    expect(caps.categories).toEqual([
      {
        id: 2000,
        name: 'Movies',
        subcategories: [{ id: 2040, name: 'Movies/HD' }],
      },
      {
        id: 5000,
        name: 'TV',
        subcategories: [
          { id: 5030, name: 'TV/SD' },
          { id: 5040, name: 'TV/HD' },
        ],
      },
    ])
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      'https://indexer.example/torznab/api?t=caps&apikey=key',
    )
  })

  it('401 — неверный ключ', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 401 }))

    expect(await kindOf(fetchCaps('https://indexer.example'))).toBe('auth')
  })

  it('ошибка 100 в теле со статусом 200 — неверный ключ', async () => {
    fetchMock.mockResolvedValue(
      new Response(torznabErrorXml(100, 'Invalid API Key')),
    )

    expect(await kindOf(fetchCaps('https://indexer.example'))).toBe('auth')
  })

  it('другая ошибка Torznab — ошибка индексатора', async () => {
    fetchMock.mockResolvedValue(
      new Response(torznabErrorXml(410, 'Indexer is disabled'), {
        status: 410,
      }),
    )

    expect(await kindOf(fetchCaps('https://indexer.example'))).toBe('remote')
  })

  it('не XML — не Torznab', async () => {
    fetchMock.mockResolvedValue(new Response('{"status":"ok"}'))

    expect(await kindOf(fetchCaps('https://indexer.example'))).toBe(
      'bad_response',
    )
  })

  it('xML без caps — не Torznab', async () => {
    fetchMock.mockResolvedValue(
      new Response('<html><body>Login</body></html>'),
    )

    expect(await kindOf(fetchCaps('https://indexer.example'))).toBe(
      'bad_response',
    )
  })

  it('5xx с HTML — ошибка индексатора', async () => {
    fetchMock.mockResolvedValue(new Response('Bad gateway', { status: 502 }))

    expect(await kindOf(fetchCaps('https://indexer.example'))).toBe('remote')
  })

  it('таймаут', async () => {
    fetchMock.mockRejectedValue(
      new DOMException('The operation timed out', 'TimeoutError'),
    )

    expect(await kindOf(fetchCaps('https://indexer.example'))).toBe('timeout')
  })

  it('сетевая ошибка — недоступен', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))

    expect(await kindOf(fetchCaps('https://indexer.example'))).toBe(
      'unreachable',
    )
  })

  it('не раскрывает ключ в сообщении ошибки', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))

    await expect(
      fetchCaps('https://indexer.example', 'secret-key'),
    ).rejects.not.toThrow(/secret-key/)
  })

  it('слишком большой ответ — не Torznab, тело не читается', async () => {
    let pulls = 0
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls++

          if (pulls > 20)
            controller.close()
          else controller.enqueue(new Uint8Array(1024))
        },
      },
      { highWaterMark: 0 },
    )

    fetchMock.mockResolvedValue(
      new Response(body, {
        headers: { 'content-length': String(17 * 1024 * 1024) },
      }),
    )

    expect(await kindOf(fetchCaps('https://indexer.example'))).toBe(
      'bad_response',
    )
    expect(pulls).toBe(0)
  })

  it('редирект с https на http — не Torznab', async () => {
    fetchMock.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: 'http://indexer.example/api' },
      }),
    )

    expect(await kindOf(fetchCaps('https://indexer.example'))).toBe(
      'bad_response',
    )
  })
})
