import type { Card, MineSection } from '@torsher/api-client'
import { effectScope, nextTick, ref } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  captureTitleViewer,
  closeTitleActions,
  noteTitleProgress,
  openTitleActions,
  setTitleViewer,
  titleActions,
} from '../titleActions.ts'
import { DEFAULT_MINE_VIEW } from '../lib/mineView.ts'
import { useMineBootstrap, useMineItems } from './useMine.ts'
import { useTitleChanges } from './useTitleChanges.ts'

const mocks = vi.hoisted(() => ({
  items: vi.fn(),
  bootstrap: vi.fn(),
  personal: vi.fn(),
}))
vi.mock('../api.ts', () => ({
  api: {
    mine: {
      getMineItems: mocks.items,
      getMineBootstrap: mocks.bootstrap,
      getMinePersonalContinue: mocks.personal,
    },
  },
  loadErrorOf: () => 'unavailable',
}))
vi.mock('./useCatalogLanguage.ts', () => ({
  useCatalogLanguage: () => ref('en-US'),
}))
let scope: ReturnType<typeof effectScope>
beforeEach(() => {
  vi.resetAllMocks()
  setTitleViewer(undefined)
  setTitleViewer('A')
  scope = effectScope()
})
afterEach(() => scope.stop())
function card(id: string) {
  return { id, kind: 'movie', title: id, originalTitle: id } as Card
}
function setup() {
  const section = ref<MineSection | undefined>({ id: 'watchlist', count: 3 })
  const view = ref({ ...DEFAULT_MINE_VIEW })
  const mine = scope.run(() => useMineItems(section, view))!
  return { mine, section, view }
}

it('keeps a failed quiet refresh dirty until a healthy reactivation', async () => {
  mocks.items.mockResolvedValueOnce({ items: [card('old')], total: 1 })
  const { mine } = setup()
  await vi.waitFor(() => expect(mine.status.value).toBe('ready'))
  const version = ref(0)
  const active = ref(true)
  scope.run(() =>
    useTitleChanges(
      () => version.value,
      () => true,
      mine.refresh,
      () => active.value,
      () => false,
    ),
  )
  mocks.items.mockRejectedValueOnce(new Error('offline'))
  version.value++
  await vi.waitFor(() => expect(mocks.items).toHaveBeenCalledTimes(2))
  await nextTick()
  expect(mine.items.value.map(item => item.card.id)).toEqual(['old'])
  mocks.items.mockResolvedValueOnce({ items: [card('fresh')], total: 1 })
  active.value = false
  await nextTick()
  active.value = true
  await vi.waitFor(() =>
    expect(mine.items.value.map(item => item.card.id)).toEqual(['fresh']),
  )
  expect(mocks.items).toHaveBeenCalledTimes(3)
})

it('does not append a stale more page after a quiet refresh has removed its cards', async () => {
  let finish!: (value: object) => void
  mocks.items.mockResolvedValueOnce({ items: [card('old')], total: 3 })
  const { mine } = setup()
  await vi.waitFor(() => expect(mine.status.value).toBe('ready'))
  mocks.items.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const more = mine.more()
  mocks.items.mockResolvedValueOnce({ items: [card('fresh')], total: 1 })
  await mine.refresh()
  finish({ items: [card('stale')], total: 3 })
  await more
  expect(mine.items.value.map(item => item.card.id)).toEqual(['fresh'])
  expect(mine.total.value).toBe(1)
})

it('does not reload the grid when only refreshed section counts change', async () => {
  mocks.items.mockResolvedValue({ items: [card('same')], total: 3 })
  const { mine, section } = setup()
  await vi.waitFor(() => expect(mine.status.value).toBe('ready'))
  section.value = { id: 'watchlist', count: 2 }
  await nextTick()
  expect(mocks.items).toHaveBeenCalledOnce()
  expect(mine.status.value).toBe('ready')
})

it('does not start pagination over old offsets while a quiet refresh is pending', async () => {
  let finish!: (value: object) => void
  mocks.items.mockResolvedValueOnce({ items: [card('old')], total: 3 })
  const { mine } = setup()
  await vi.waitFor(() => expect(mine.status.value).toBe('ready'))
  mocks.items.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const refresh = mine.refresh()
  await mine.more()
  expect(mocks.items).toHaveBeenCalledTimes(2)
  finish({ items: [card('fresh')], total: 3 })
  await refresh
  mocks.items.mockResolvedValueOnce({ items: [card('next')], total: 3 })
  await mine.more()
  expect(mine.items.value.map(item => item.card.id)).toEqual([
    'fresh',
    'next',
  ])
})

it('ignores an in-flight page after viewer changes, including A/B/A', async () => {
  let finish!: (value: object) => void
  mocks.items.mockResolvedValueOnce({ items: [card('old')], total: 3 })
  const { mine } = setup()
  await vi.waitFor(() => expect(mine.status.value).toBe('ready'))
  mocks.items.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const more = mine.more()
  setTitleViewer('B')
  setTitleViewer('A')
  finish({ items: [card('stale')], total: 3 })
  await more
  expect(mine.items.value.map(item => item.card.id)).toEqual(['old'])
})

it('coalesces section and its saved view into one request with the final settings', async () => {
  mocks.items.mockResolvedValue({ items: [card('same')], total: 3 })
  const { mine, section, view } = setup()
  await vi.waitFor(() => expect(mine.status.value).toBe('ready'))
  mocks.items.mockClear()
  section.value = { id: 'ratings', count: 2 }
  view.value = { ...DEFAULT_MINE_VIEW, sort: 'rating', kind: 'series' }
  await nextTick()
  expect(mocks.items).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      section: 'ratings',
      sort: 'rating',
      kind: 'series',
    }),
    expect.any(Object),
  )
})

it('delivers Schedule menu changes after leaving an unfinished grid request', async () => {
  let finish!: (value: object) => void
  mocks.items.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const { mine, section } = setup()
  const refreshSchedule = vi.fn(() => Promise.resolve())
  scope.run(() =>
    useTitleChanges(
      () => titleActions.version,
      () => mine.refreshReady.value,
      refreshSchedule,
      () => true,
      () => !!titleActions.target,
    ),
  )
  expect(mine.status.value).toBe('loading')
  section.value = undefined
  openTitleActions({ id: 'title', title: 'Title', kind: 'series' })
  noteTitleProgress(captureTitleViewer(), 'title')
  await nextTick()
  expect(refreshSchedule).not.toHaveBeenCalled()
  closeTitleActions()
  await nextTick()
  expect(refreshSchedule).toHaveBeenCalledOnce()
  finish({ items: [card('stale')], total: 3 })
  await nextTick()
  await nextTick()
  expect(mine.items.value).toEqual([])
})

it('reads an unknown count and never short-circuits the personal Continue endpoint on the normal count', async () => {
  mocks.items.mockResolvedValue({ items: [card('known')], total: 1 })
  const { mine, section } = setup()
  section.value = { id: 'watchlist' } as MineSection
  await vi.waitFor(() => expect(mine.items.value[0]?.card.id).toBe('known'))
  mocks.personal.mockResolvedValue({ profileId: 'A', items: [], total: 0 })
  section.value = { id: 'continue', count: 0 }
  await vi.waitFor(() =>
    expect(mocks.personal).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ expectedProfileId: 'A' }),
      expect.any(Object),
    ),
  )
})

it('discards a bootstrap from the previous viewer generation even after A/B/A', async () => {
  const result = Promise.withResolvers<object>()
  mocks.bootstrap.mockReturnValueOnce(result.promise)
  const mine = scope.run(() => useMineBootstrap())!
  setTitleViewer('B')
  setTitleViewer('A')
  result.resolve({ profileId: 'A' })
  await result.promise
  await nextTick()
  expect(mine.bootstrap.value).toBeUndefined()
})
