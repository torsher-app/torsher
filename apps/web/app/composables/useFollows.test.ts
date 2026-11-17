import type { FollowDetails } from '@torsher/api-client'
import { computed, effectScope, nextTick, ref, shallowRef, watch } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  search: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}))
vi.mock('~/services/api', () => ({
  api: {
    follows: {
      getFollow: mocks.get,
      postFollowSearch: mocks.search,
      updateFollow: mocks.update,
      deleteFollow: mocks.remove,
    },
  },
}))
let locale = ref('en_US')
let visibility = ref('visible')
vi.mock('vue-i18n', () => ({ useI18n: () => ({ locale }) }))
vi.mock('@vueuse/core', () => ({ useDocumentVisibility: () => visibility }))
let store: ReturnType<(typeof import('./useFollows'))['useFollows']>
let module: typeof import('./useFollows')
let scope = effectScope()

function details(id = 'a', patch: Partial<FollowDetails> = {}) {
  return {
    id,
    titleId: `tmdb:tv:${id}`,
    state: 'active',
    episodes: [],
    searchRequested: false,
    lastSearchAt: null,
    nextSearchAt: null,
    ...patch,
  } as FollowDetails
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
  vi.resetAllMocks()
  vi.useFakeTimers()
  locale = ref('en_US')
  visibility = ref('visible')
  for (const [name, value] of Object.entries({
    ref,
    shallowRef,
    computed,
    watch,
    withErrorMode: (_mode: string, fn: () => unknown) => fn(),
  }))
    vi.stubGlobal(name, value)
  mocks.get.mockResolvedValue(details())
  mocks.search.mockResolvedValue(undefined)
  module = await import('./useFollows')
  store = module.useFollows()
  store.follows.value = [details()]
  scope = effectScope()
})
afterEach(() => {
  scope.stop()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
function open(id = ref<string | null>('a')) {
  scope.run(() => module.useFollowDetailsPolling(() => id.value))
  return id
}

it('reproduces F-008 without a card subscription: server completion stays stale', async () => {
  await store.loadDetails('a')
  await store.searchNow('a')
  mocks.get.mockResolvedValue(
    details('a', { lastSearchAt: '2026-11-17T10:00:00Z' }),
  )
  await vi.advanceTimersByTimeAsync(10_000)
  expect(store.details.value?.searchRequested).toBe(true)
  expect(mocks.get).toHaveBeenCalledTimes(1)
})

it('refreshes completion, schedule, episodes and summary without reopening', async () => {
  await store.loadDetails('a')
  open()
  await store.searchNow('a')
  expect(store.details.value?.searchRequested).toBe(true)
  const completed = details('a', {
    lastSearchAt: '2026-11-17T10:00:00Z',
    nextSearchAt: '2026-11-18T10:00:00Z',
    state: 'done',
    episodes: [
      {
        season: 1,
        episode: 1,
        state: 'ready',
        candidates: 1,
        airDate: '2026-11-16',
      },
    ],
  })
  mocks.get.mockResolvedValue(completed)
  await vi.advanceTimersByTimeAsync(2000)
  expect(store.details.value).toEqual(completed)
  expect(store.follows.value[0]?.state).toBe('done')
})

it('keeps data on error and retries without overlapping requests', async () => {
  await store.loadDetails('a')
  open()
  mocks.get.mockRejectedValueOnce(new Error('offline'))
  await vi.advanceTimersByTimeAsync(2000)
  expect(store.details.value?.id).toBe('a')
  const pending = deferred<FollowDetails>()
  mocks.get.mockReturnValueOnce(pending.promise)
  await vi.advanceTimersByTimeAsync(10_000)
  expect(mocks.get).toHaveBeenCalledTimes(3)
  pending.resolve(details())
  await vi.advanceTimersByTimeAsync(2000)
  expect(mocks.get).toHaveBeenCalledTimes(4)
})

it.each(['close', 'switch', 'hide', 'dispose'])(
  'discards an in-flight poll after %s',
  async (action) => {
    await store.loadDetails('a')
    const selected = open()
    const pending = deferred<FollowDetails>()
    mocks.get.mockReturnValueOnce(pending.promise)
    await vi.advanceTimersByTimeAsync(2000)
    if (action === 'close')
      selected.value = null
    if (action === 'switch')
      selected.value = 'b'
    if (action === 'hide')
      visibility.value = 'hidden'
    if (action === 'dispose')
      scope.stop()
    await nextTick()
    pending.resolve(details('a', { state: 'done' }))
    await vi.advanceTimersByTimeAsync(0)
    expect(store.details.value?.state).toBe('active')
    if (action !== 'switch') {
      await vi.advanceTimersByTimeAsync(10_000)
      expect(mocks.get).toHaveBeenCalledTimes(2)
    }
  },
)

it('resumes polling after reopening and returning to the visible tab', async () => {
  const selected = open(ref<string | null>(null))
  await vi.advanceTimersByTimeAsync(4000)
  expect(mocks.get).not.toHaveBeenCalled()
  selected.value = 'a'
  await nextTick()
  await vi.advanceTimersByTimeAsync(2000)
  visibility.value = 'hidden'
  await nextTick()
  await vi.advanceTimersByTimeAsync(4000)
  expect(mocks.get).toHaveBeenCalledTimes(1)
  visibility.value = 'visible'
  await nextTick()
  await vi.advanceTimersByTimeAsync(2000)
  expect(mocks.get).toHaveBeenCalledTimes(2)
})

it('discards an old read after a newer read', async () => {
  const pending = deferred<FollowDetails>()
  mocks.get.mockReturnValueOnce(pending.promise)
  const old = store.loadDetails('a')
  mocks.get.mockResolvedValueOnce(details('b'))
  await store.loadDetails('b')
  pending.resolve(details('a'))
  await old
  expect(store.details.value?.id).toBe('b')
})

it.each(['search', 'update', 'remove', 'language'])(
  'discards an old read after %s',
  async (action) => {
    await store.loadDetails('a')
    const pending = deferred<FollowDetails>()
    mocks.get.mockReturnValueOnce(pending.promise)
    const old = store.loadDetails('a')
    if (action === 'search')
      await store.searchNow('a')
    if (action === 'update') {
      mocks.update.mockResolvedValue(details('a', { state: 'paused' }))
      await store.update('a', { state: 'paused' })
    }
    if (action === 'remove')
      await store.remove('a')
    if (action === 'language')
      locale.value = 'ru_RU'
    pending.resolve(details('a', { state: 'done' }))
    await old
    expect(store.details.value?.state).not.toBe('done')
    if (action === 'search')
      expect(store.details.value?.searchRequested).toBe(true)
    if (action === 'remove')
      expect(store.details.value).toBeNull()
  },
)

it('waits for a pending mutation before polling again', async () => {
  await store.loadDetails('a')
  open()
  const pending = deferred<FollowDetails>()
  mocks.update.mockReturnValueOnce(pending.promise)
  const updating = store.update('a', { state: 'paused' })
  await vi.advanceTimersByTimeAsync(6000)
  expect(mocks.get).toHaveBeenCalledTimes(1)
  pending.resolve(details('a', { state: 'paused' }))
  await updating
  mocks.get.mockResolvedValueOnce(details('a', { state: 'paused' }))
  await vi.advanceTimersByTimeAsync(2000)
  expect(mocks.get).toHaveBeenCalledTimes(2)
  expect(store.details.value?.state).toBe('paused')
})
