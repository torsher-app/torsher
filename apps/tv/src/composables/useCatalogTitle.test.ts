import { effectScope, ref } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import { useCatalogTitle } from './useCatalogTitle.ts'

vi.mock('./useCatalogLanguage.ts', () => ({
  useCatalogLanguage: () => ref('en-US'),
}))
vi.mock('../serverSources.ts', () => ({ noteHasSources: vi.fn() }))

afterEach(() => vi.unstubAllGlobals())

it('recovers the same title after two temporary 503 responses without a settings change', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response('{"message":"Service unavailable"}', { status: 503 }),
    )
    .mockResolvedValueOnce(
      new Response('{"message":"Service unavailable"}', { status: 503 }),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'tmdb:tv:1396',
          title: 'Test series',
          hasSources: false,
        }),
        { status: 200 },
      ),
    )
  vi.stubGlobal('fetch', fetchMock)
  const scope = effectScope()
  try {
    const resource = scope.run(() => useCatalogTitle(ref('tmdb:tv:1396')))!
    await vi.waitFor(() => expect(resource.status.value).toBe('error'))
    expect(resource.error.value).toBe('unavailable')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await resource.retry()
    expect(resource.status.value).toBe('ready')
    expect(resource.title.value?.id).toBe('tmdb:tv:1396')
    const urls = fetchMock.mock.calls.map(args => String(args[0]))
    expect(new Set(urls).size).toBe(1)
  }
  finally {
    scope.stop()
  }
})
