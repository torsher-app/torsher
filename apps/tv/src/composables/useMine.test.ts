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
import { useMineItems } from './useMine.ts'
import { useTitleChanges } from './useTitleChanges.ts'

const mocks = vi.hoisted(() => ({ items: vi.fn() }))
vi.mock('../api.ts', () => ({
  api: { mine: { getMineItems: mocks.items } },
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
  return ({ id, kind: 'movie', title: id, originalTitle: id }) as Card
}
function setup() {
  const section = ref<MineSection | undefined>({ id: 'watchlist', count: 3 })
  const view = ref({ ...DEFAULT_MINE_VIEW })
  const mine = scope.run(() => useMineItems(section, view))!
  return { mine, section, view }
}

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
  expect(mine.items.value.map(item => item.id)).toEqual(['fresh'])
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
  expect(mine.items.value.map(item => item.id)).toEqual(['fresh', 'next'])
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
  expect(mine.items.value.map(item => item.id)).toEqual(['old'])
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
