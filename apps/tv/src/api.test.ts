import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, loadErrorOf, onProfileRequired } from './api.ts'

function respond(status: number, body: object) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
    ),
  )
}

describe('api of the showcase', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    onProfileRequired(() => {})
  })

  it('reports that the server wants a profile chosen', async () => {
    const handler = vi.fn()

    onProfileRequired(handler)
    respond(403, { message: 'profile_required' })

    await expect(api.mine.getMine()).rejects.toThrow()
    expect(handler).toHaveBeenCalledOnce()
  })

  it('leaves other refusals to the screen', async () => {
    const handler = vi.fn()

    onProfileRequired(handler)
    respond(403, { message: 'Forbidden' })

    await expect(api.mine.getMine()).rejects.toThrow()
    respond(404, { message: 'profile_required' })
    await expect(api.mine.getMine()).rejects.toThrow()
    expect(handler).not.toHaveBeenCalled()
  })
})

// Exercise the real fetch core (including its automatic GET retry).
describe('catalog load errors', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each([
    [undefined, 'unavailable'],
    ['config', 'notConfigured'],
    ['unknown', 'unavailable'],
  ] as const)(
    'classifies 503 with reason %s as %s',
    async (reason, expected) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response(JSON.stringify({ message: 'Service unavailable' }), {
              status: 503,
              headers: reason ? { 'X-Torsher-Catalog-Error': reason } : {},
            }),
        ),
      )
      const error = await api.catalog
        .getCatalogTitle('tmdb:tv:1396')
        .catch(error => error)
      expect(loadErrorOf(error)).toBe(expected)
    },
  )

  it('handles a proxy HTML response without claiming a missing key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('Service unavailable', { status: 503 })),
    )
    const error = await api.catalog
      .getCatalogTitle('tmdb:tv:1396')
      .catch(error => error)
    expect(loadErrorOf(error)).toBe('unavailable')
    expect(loadErrorOf(new TypeError('offline'))).toBe('unknown')
  })
})
