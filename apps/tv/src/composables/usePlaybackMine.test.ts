import type { Card, MineBootstrap } from '@torsher/api-client'
import { computed, effectScope, nextTick, ref } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_MINE_VIEW } from '../lib/mineView.ts'
import { setTitleViewer, titleActions } from '../titleActions.ts'
import { useMineBootstrap, useMineItems } from './useMine.ts'
import { usePlayback } from './usePlayback.ts'
import { useTitleChanges } from './useTitleChanges.ts'

const mocks = vi.hoisted(() => ({
  personal: vi.fn(),
  watched: vi.fn(),
  save: vi.fn(),
  sections: vi.fn(),
  items: vi.fn(),
}))
vi.mock('../api.ts', () => ({
  api: {
    mine: {
      getMineBootstrap: mocks.sections,
      getMineItems: mocks.items,
      getMinePersonalContinue: mocks.personal,
      getMinePersonalWatched: mocks.watched,
    },
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
    const bootstrap = (): MineBootstrap => ({
      version: 1,
      profileId: 'viewer',
      language: null,
      timeZone: 'UTC',
      today: '2026-11-19',
      start: { kind: 'section', section: 'continue' },
      collections: [],
      counts: {
        continue: 0,
        watched: 0,
        schedule: null,
        favorites: 0,
        ratings: 0,
        watchlist: 0,
        dropped: 0,
        [section]: saved ? 0 : 1,
        [next]: saved ? 1 : 0,
      },
    })
    mocks.sections.mockImplementation(async () => bootstrap())
    const row = {
      titleId: card.id,
      kind: card.kind,
      metadata: { title: card.title },
      ownRating: null,
    }
    mocks.personal.mockImplementation(async () => ({
      profileId: 'viewer',
      items: (section === 'continue' ? !saved : saved)
        ? [{ ...row, continuation: 'normal', cycle: null, normalResume: null }]
        : [],
      total: (section === 'continue' ? !saved : saved) ? 1 : 0,
    }))
    mocks.watched.mockImplementation(async () => ({
      profileId: 'viewer',
      items: saved ? [row] : [],
      total: saved ? 1 : 0,
    }))
    mocks.items.mockImplementation(async (query: { section: string }) => ({
      items: (query.section === section ? !saved : saved) ? [card] : [],
      total: (query.section === section ? !saved : saved) ? 1 : 0,
    }))
    const active = ref(true)
    const view = ref({ ...DEFAULT_MINE_VIEW, kind, sort: 'rating' as const })
    const selected = ref<typeof section | typeof next>(section)
    const { groups, mine, player } = scope.run(() => {
      const groups = useMineBootstrap()
      const current = computed(() =>
        groups.bootstrap.value
          ? {
              id: selected.value,
              count: groups.bootstrap.value.counts[selected.value] ?? undefined,
            }
          : undefined,
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
    await vi.waitFor(() =>
      expect(mine.items.value.map(item => item.card.id)).toEqual([card.id]),
    )
    const initialRequests = mocks.sections.mock.calls.length
    active.value = false
    await nextTick()

    // A failed checkpoint must not pretend that playback has changed the server lists.
    mocks.save.mockRejectedValueOnce(new Error('offline'))
    await player.saveWatchState(position, duration)
    active.value = true
    await nextTick()
    expect(mocks.sections).toHaveBeenCalledTimes(initialRequests)
    expect(mine.items.value.map(item => item.card.id)).toEqual([card.id])
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
    expect(mine.items.value.map(item => item.card.id)).toEqual([card.id])

    active.value = true
    await vi.waitFor(() => {
      expect(groups.bootstrap.value).toEqual(bootstrap())
      expect(mine.items.value).toEqual([])
    })
    expect(mocks.sections).toHaveBeenCalledTimes(initialRequests + 1)
    expect(mine.status.value).toBe('ready')
    expect(view.value).toEqual({ ...DEFAULT_MINE_VIEW, kind, sort: 'rating' })
    selected.value = next
    await vi.waitFor(() =>
      expect(mine.items.value.map(item => item.card.id)).toEqual([card.id]),
    )
    expect(
      next === 'continue' ? mocks.personal : mocks.watched,
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({
        expectedProfileId: 'viewer',
        kind,
        sort: 'rating',
      }),
      expect.any(Object),
    )
  },
)
