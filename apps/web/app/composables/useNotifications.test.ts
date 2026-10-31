import type { NotificationItem, NotificationList } from '@torsher/api-client'
import type { EffectScope } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

const api = vi.hoisted(() => ({
  getNotifications: vi.fn(),
  getUnreadNotifications: vi.fn(),
  markNotificationsRead: vi.fn(),
}))

vi.mock('~/services/api', () => ({ api: { notifications: api } }))

let scope: EffectScope
let store: typeof import('./useNotifications')

function item(id: string): NotificationItem {
  return {
    id,
    kind: 'device_paired',
    severity: 'info',
    params: {},
    createdAt: '2026-10-31T10:00:00Z',
  }
}

function page(ids: string[], unread = ids.length): NotificationList {
  return { items: ids.map(item), unread }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })

  return { promise, resolve }
}

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.stubGlobal('withErrorMode', (_mode: string, request: () => unknown) =>
    request())
  api.markNotificationsRead.mockResolvedValue(undefined)
  scope = effectScope()
  store = await import('./useNotifications')
})

afterEach(() => {
  scope.stop()
  vi.unstubAllGlobals()
})

describe('notification feeds', () => {
  it('keeps bell and filtered page in sync after reading; retains rows until reload', async () => {
    const bell = store.useNotifications()
    const feed = scope.run(() =>
      store.useNotificationFeed(() => ({ unread: true })),
    )!

    api.getNotifications.mockResolvedValue(page(['a', 'b']))
    await bell.load()
    await feed.load()
    expect(
      api.getNotifications.mock.calls.map(([query]) => query.limit),
    ).toEqual([20, 50])
    expect(api.getNotifications.mock.calls[1]![0].unread).toBe('1')

    await Promise.all([feed.markRead('a'), bell.markRead('a')])
    expect(api.markNotificationsRead).toHaveBeenCalledTimes(1)
    expect(bell.unread.value).toBe(1)
    expect(bell.items.value[0]!.readAt).toBeDefined()
    expect(feed.items.value[0]!.readAt).toBeDefined()

    await bell.markAllRead()
    expect(feed.items.value).toHaveLength(2)
    expect(feed.items.value.every(entry => entry.readAt)).toBe(true)
    expect(feed.unread.value).toBe(0)
  })

  it('does not mark rows or clear the counter on failed mutations', async () => {
    const bell = store.useNotifications()

    api.getNotifications.mockResolvedValue(page(['a']))
    await bell.load()
    api.markNotificationsRead.mockRejectedValue(new Error('offline'))
    await expect(bell.markRead('a')).rejects.toThrow('offline')
    await expect(bell.markAllRead()).rejects.toThrow('offline')
    expect(bell.items.value[0]!.readAt).toBeUndefined()
    expect(bell.unread.value).toBe(1)
  })

  it('finishes queued reads after navigation unmounts the page', async () => {
    const feed = scope.run(() => store.useNotificationFeed(() => ({})))!
    const response = deferred<void>()

    api.getNotifications.mockResolvedValue(page(['a', 'b']))
    await feed.load()
    api.markNotificationsRead.mockReturnValueOnce(response.promise)
    const first = feed.markRead('a')

    await vi.waitFor(() =>
      expect(api.markNotificationsRead).toHaveBeenCalledTimes(1),
    )
    const second = feed.markRead('b')

    scope.stop()
    response.resolve()
    await Promise.all([first, second])
    expect(api.markNotificationsRead).toHaveBeenCalledTimes(2)
    expect(feed.unread.value).toBe(0)
  })

  it('discards an old page when filters change', async () => {
    let group: 'downloads' | 'problems' = 'downloads'
    const feed = scope.run(() => store.useNotificationFeed(() => ({ group })))!
    const old = deferred<NotificationList>()

    api.getNotifications.mockReturnValueOnce(old.promise)
    const first = feed.load()

    await vi.waitFor(() =>
      expect(api.getNotifications).toHaveBeenCalledTimes(1),
    )
    group = 'problems'
    api.getNotifications.mockResolvedValueOnce(page(['new']))
    await feed.load({ reset: true })
    old.resolve(page(['old']))
    await first
    expect(feed.items.value.map(entry => entry.id)).toEqual(['new'])
  })

  it('retries an in-flight GET after a read so it cannot restore unread dots', async () => {
    const bell = store.useNotifications()

    api.getNotifications.mockResolvedValueOnce(page(['a']))
    await bell.load()
    const old = deferred<NotificationList>()

    api.getNotifications.mockReturnValueOnce(old.promise)
    const loading = bell.load()

    await vi.waitFor(() =>
      expect(api.getNotifications).toHaveBeenCalledTimes(2),
    )
    await bell.markAllRead()
    api.getNotifications.mockResolvedValueOnce({
      items: [{ ...item('a'), readAt: '2026-10-31T12:00:00Z' }],
      unread: 0,
    })
    old.resolve(page(['a']))
    await loading
    expect(bell.unread.value).toBe(0)
    expect(bell.items.value[0]!.readAt).toBeDefined()
  })

  it('preserves visible rows after a pagination error and removes duplicate IDs', async () => {
    const feed = scope.run(() => store.useNotificationFeed(() => ({})))!

    api.getNotifications.mockResolvedValueOnce({
      ...page(['a']),
      nextCursor: 'a',
    })
    await feed.load()
    api.getNotifications.mockRejectedValueOnce(new Error('offline'))
    await expect(feed.loadMore()).rejects.toThrow('offline')
    expect(feed.items.value.map(entry => entry.id)).toEqual(['a'])
    expect(feed.isLoadingMore.value).toBe(false)
    api.getNotifications.mockResolvedValueOnce(page(['a', 'b']))
    await feed.loadMore()
    expect(feed.items.value.map(entry => entry.id)).toEqual(['a', 'b'])
    expect(feed.hasMore.value).toBe(false)
  })
})
