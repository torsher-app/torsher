import type { Card, MineSection } from '@torsher/api-client'
import { computed, effectScope, nextTick, ref } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_MINE_VIEW } from '../lib/mineView.ts'
import { setTitleViewer, titleActions } from '../titleActions.ts'
import { useMineItems, useMineSections } from './useMine.ts'
import { usePlayback } from './usePlayback.ts'
import { useTitleChanges } from './useTitleChanges.ts'

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  sections: vi.fn(),
  items: vi.fn(),
}))
vi.mock('../api.ts', () => ({
  api: {
    mine: { getMine: mocks.sections, getMineItems: mocks.items },
    watchState: { putWatchState: mocks.save },
  },
  loadErrorOf: () => 'unavailable',
}))
vi.mock('../diagnostics/index.ts', async original => ({
  ...(await original<typeof import('../diagnostics/index.ts')>()),
  diagnostic: vi.fn(),
}))
vi.mock('../i18n.ts', () => ({
  i18n: { global: { locale: { value: 'en_US' } } },
}))
vi.mock('../platform/android.ts', () => ({ nativeDeviceProfile: () => ({}) }))
vi.mock('../platform/webos.ts', () => ({ isWebos: () => false }))
vi.mock('./useCatalogLanguage.ts', () => ({
  useCatalogLanguage: () => ref('en-US'),
}))

let scope: ReturnType<typeof effectScope>
beforeEach(() => {
  vi.resetAllMocks()
  setTitleViewer(undefined)
  setTitleViewer('viewer')
  scope = effectScope()
})
afterEach(() => scope.stop())

it.each([
  {
    kind: 'series',
    section: 'dropped',
    next: 'continue',
    position: 246,
    duration: 2893,
  },
  {
    kind: 'movie',
    section: 'continue',
    next: 'watched',
    position: 100,
    duration: 100,
  },
] as const)(
  'refreshes cached Mine counts and $section items after a saved $kind playback on return',
  async ({ kind, section, next, position, duration }) => {
    const card = {
      id: 'title',
      kind,
      title: 'Title',
      originalTitle: 'Title',
    } as Card
    let saved = false
    const sections = (): MineSection[] => [
      { id: section, count: saved ? 0 : 1 },
      { id: next, count: saved ? 1 : 0 },
    ]
    mocks.sections.mockImplementation(async () => ({ sections: sections() }))
    mocks.items.mockImplementation(async (query: { section: string }) => ({
      items: (query.section === section ? !saved : saved) ? [card] : [],
      total: (query.section === section ? !saved : saved) ? 1 : 0,
    }))
    const active = ref(true)
    const view = ref({ ...DEFAULT_MINE_VIEW, kind, sort: 'rating' as const })
    const selected = ref<string>(section)
    const { groups, mine, player } = scope.run(() => {
      const groups = useMineSections()
      const current = computed(() =>
        groups.sections.value.find(item => item.id === selected.value),
      )
      const mine = useMineItems(current, view)
      useTitleChanges(
        () => titleActions.version,
        () => groups.status.value === 'ready' && mine.refreshReady.value,
        () => Promise.all([groups.refresh(), mine.refresh()]),
        () => active.value,
        () => false,
      )
      const player = usePlayback({ mediaFileId: 'local-file' })
      return { groups, mine, player }
    })!
    await vi.waitFor(() => expect(mine.items.value).toEqual([card]))
    const initialRequests = mocks.sections.mock.calls.length
    active.value = false
    await nextTick()

    // A failed checkpoint must not pretend that playback has changed the server lists.
    mocks.save.mockRejectedValueOnce(new Error('offline'))
    await player.saveWatchState(position, duration)
    active.value = true
    await nextTick()
    expect(mocks.sections).toHaveBeenCalledTimes(initialRequests)
    expect(mine.items.value).toEqual([card])
    active.value = false
    await nextTick()

    // Even a completed HTTP save must leave the sleeping screen alone until return.
    let accept!: () => void
    mocks.save.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          accept = () => {
            saved = true
            resolve()
          }
        }),
    )
    const saving = player.saveWatchState(position, duration, 'exit')
    expect(mocks.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mediaFileId: 'local-file',
        position,
        duration,
      }),
      expect.any(Object),
    )
    expect(mocks.sections).toHaveBeenCalledTimes(initialRequests)
    accept()
    await saving
    await nextTick()
    expect(mocks.sections).toHaveBeenCalledTimes(initialRequests)
    expect(mine.items.value).toEqual([card])

    active.value = true
    await vi.waitFor(() => {
      expect(groups.sections.value).toEqual(sections())
      expect(mine.items.value).toEqual([])
    })
    expect(mocks.sections).toHaveBeenCalledTimes(initialRequests + 1)
    expect(mine.status.value).toBe('ready')
    expect(view.value).toEqual({ ...DEFAULT_MINE_VIEW, kind, sort: 'rating' })
    selected.value = next
    await vi.waitFor(() => expect(mine.items.value).toEqual([card]))
    expect(mocks.items).toHaveBeenLastCalledWith(
      expect.objectContaining({
        section: next,
        kind,
        sort: 'rating',
      }),
      expect.any(Object),
    )
  },
)
