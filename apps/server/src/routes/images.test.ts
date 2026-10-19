import { Buffer } from 'node:buffer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../app.ts'

const app = createApp()
const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('get /img/:size/:file', () => {
  it('отдаёт картинку TMDB без авторизации и с долгим кэшем', async () => {
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { 'content-type': 'image/jpeg' },
      }),
    )

    const res = await app.inject({ url: '/img/w342/abc123.jpg' })

    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      'https://image.tmdb.org/t/p/w342/abc123.jpg',
    )
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('image/jpeg')
    expect(res.headers['cache-control']).toBe(
      'public, max-age=31536000, immutable',
    )
    expect(res.rawPayload).toEqual(Buffer.from([1, 2, 3]))
  })

  it.each([
    '/img/w9999/abc123.jpg',
    '/img/w342/abc123.html',
    '/img/w342/%2E%2E%2Fabc.jpg',
    '/img/w342/sub%2Fabc.jpg',
  ])('отвечает 400 на %s', async (url) => {
    const res = await app.inject({ url })

    expect(res.statusCode).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('отвечает 404, если картинки нет', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 404 }))

    const res = await app.inject({ url: '/img/w342/missing.jpg' })

    expect(res.statusCode).toBe(404)
  })

  it('отвечает 502, если TMDB недоступен', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))

    const res = await app.inject({ url: '/img/w342/abc123.jpg' })

    expect(res.statusCode).toBe(502)
  })

  it('не проксирует не-картинки', async () => {
    fetchMock.mockResolvedValue(
      new Response('<html>', { headers: { 'content-type': 'text/html' } }),
    )

    const res = await app.inject({ url: '/img/w342/abc123.jpg' })

    expect(res.statusCode).toBe(502)
  })
})
