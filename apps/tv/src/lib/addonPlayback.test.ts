import { afterEach, expect, it, vi } from 'vitest'
import { setTitleViewer } from '../titleActions.ts'
import {
  addonLaunchOf,
  addonPlaybackRoute,
  selectAddonSource,
} from './addonPlayback.ts'

const post = vi.hoisted(() => vi.fn())
vi.mock('../api.ts', () => ({
  api: { titles: { postTitleAddonSourcePlay: post } },
}))

afterEach(() => {
  post.mockReset()
  setTitleViewer(undefined)
  vi.useRealTimers()
})

it('keeps the ephemeral launch grant out of navigation data and rejects it after a profile switch', () => {
  setTitleViewer('viewer')
  const route = addonPlaybackRoute(
    { kind: 'http', launchId: 'grant-from-server' },
    { id: 'tmdb:tv:42', season: 0, episode: 2 },
  )
  expect(route.query).toMatchObject({
    season: '0',
    episode: '2',
    title: 'tmdb:tv:42',
  })
  expect(JSON.stringify(route)).not.toContain('grant-from-server')
  const instance = route.path.split('/').at(-1)!
  expect(addonLaunchOf(instance)).toBe('grant-from-server')
  setTitleViewer('other')
  setTitleViewer('viewer')
  expect(addonLaunchOf(instance)).toBeUndefined()
})

it('cancels a pending torrent selection without repeating the request', async () => {
  vi.useFakeTimers()
  post.mockResolvedValue({
    kind: 'torrent',
    status: 'resolving',
    torrentId: 'torrent',
  })
  const operation = new AbortController()
  const selection = selectAddonSource(
    'tmdb:movie:42',
    'candidate',
    operation.signal,
  )
  const result = expect(selection).rejects.toThrow('Cancelled')
  await vi.advanceTimersByTimeAsync(0)
  operation.abort()
  await result
  await vi.advanceTimersByTimeAsync(5000)
  expect(post).toHaveBeenCalledTimes(1)
})
