import type { MineTitlePersonal, TitleMine } from '@torsher/api-client'
import { createRenderer, nextTick, ref, ssrContextKey } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  closeTitleActions,
  openTitleActions,
  setTitleViewer,
} from '../titleActions.ts'
import TitleActions from './TitleActions.vue'

const mocks = vi.hoisted(() => ({
  personal: vi.fn(),
  put: vi.fn(),
  mine: vi.fn(),
}))
vi.mock('../api.ts', () => ({
  api: {
    mine: { getMineTitlePersonal: mocks.personal, putMineSeen: mocks.put },
    titles: {
      getTitleMine: mocks.mine,
      getTitleDownload: () => Promise.reject(new Error('No download')),
    },
  },
}))
vi.mock('../focus/index.ts', () => ({
  useFocus: () => ({ current: () => undefined }),
}))
vi.mock('../focus/titleActionReturn.ts', () => ({
  captureTitleActionReturn: () => () => false,
}))
vi.mock('../composables/useCatalogLanguage.ts', () => ({
  useCatalogLanguage: () => ref('en-US'),
}))
vi.mock('../composables/useTitleDownload.ts', () => ({
  useDownloadTexts: () => ({}),
}))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('./AppToast.vue', () => ({ default: {} }))
vi.mock('./OptionsPanel.vue', () => ({ default: {} }))
vi.mock('./RatingPicker.vue', () => ({ default: {} }))

const renderer = createRenderer<object, object>({
  patchProp() {},
  insert() {},
  remove() {},
  setElementText() {},
  setText() {},
  createElement: () => ({}),
  createText: () => ({}),
  createComment: () => ({}),
  parentNode: () => null,
  nextSibling: () => null,
})
let dispose: (() => void) | undefined
beforeEach(() => {
  vi.resetAllMocks()
  setTitleViewer(undefined)
  setTitleViewer('A')
})
afterEach(() => {
  dispose?.()
  closeTitleActions()
})

function mountSubject() {
  const app = renderer.createApp({ ...TitleActions, render: () => null })
  app.provide(ssrContextKey, { modules: new Set() })
  app.mount({})
  dispose = () => app.unmount()
  return (
    app as unknown as {
      _instance: {
        setupState: {
          mainOptions: { id: string, label: string, disabled?: boolean }[]
          loadToken: number
          loadPersonal: (id: string, token: number) => Promise<void>
          toggleWatched: () => Promise<void>
        }
      }
    }
  )._instance.setupState
}

it('updates the open watched action from each personal PUT, including rated-only titles', async () => {
  const personal: MineTitlePersonal = {
    titleId: 'film',
    continuation: 'normal',
    note: null,
    notInterested: false,
    status: 'watched',
    seen: { title: false, episode: null },
    cycle: null,
  }
  // A rating keeps legacy status watched even after the user's explicit unwatch.
  const legacy = {
    status: 'watched',
    rating: 9,
    collections: [],
    watchlist: false,
    favorite: false,
  } satisfies TitleMine
  mocks.personal.mockImplementation(async () => ({
    ...personal,
    seen: { ...personal.seen },
  }))
  mocks.mine.mockResolvedValue(legacy)
  mocks.put.mockImplementation(
    async (_id: string, body: { watched: boolean }) => {
      personal.seen.title = body.watched
      return { ...personal, seen: { ...personal.seen } }
    },
  )
  const vm = mountSubject()
  openTitleActions({ id: 'film', title: 'Fictional film', kind: 'movie' })
  await Promise.resolve()
  await Promise.resolve()
  await nextTick()
  expect(vm.mainOptions.find(row => row.id === 'watched')?.label).toBe(
    'actions.markWatched',
  )
  await vm.toggleWatched()
  expect(vm.mainOptions.find(row => row.id === 'watched')?.label).toBe(
    'actions.unmarkWatched',
  )
  await vm.toggleWatched()
  expect(mocks.put.mock.calls.map(([, body]) => body.watched)).toEqual([
    true,
    false,
  ])
  expect(vm.mainOptions.find(row => row.id === 'watched')?.label).toBe(
    'actions.markWatched',
  )
})

it('writes a confirmed personal toggle even while legacy list state is still loading', async () => {
  const personal: MineTitlePersonal = {
    titleId: 'film',
    continuation: 'normal',
    note: null,
    notInterested: false,
    status: 'watched',
    seen: { title: true, episode: null },
    cycle: null,
  }
  const legacy: TitleMine = {
    status: 'watched',
    rating: 9,
    collections: [],
    watchlist: false,
    favorite: false,
  }
  let finish!: (value: TitleMine) => void
  mocks.personal.mockResolvedValue(personal)
  mocks.mine
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    .mockResolvedValue(legacy)
  mocks.put.mockResolvedValue({
    ...personal,
    seen: { title: false, episode: null },
  })
  const vm = mountSubject()
  openTitleActions({ id: 'film', title: 'Fictional film', kind: 'movie' })
  await Promise.resolve()
  await nextTick()
  expect(vm.mainOptions.find(row => row.id === 'watched')?.disabled).toBe(
    false,
  )
  await vm.toggleWatched()
  expect(mocks.put).toHaveBeenCalledWith(
    'film',
    expect.objectContaining({ watched: false }),
  )
  finish(legacy)
  await Promise.resolve()
  expect(vm.mainOptions.find(row => row.id === 'watched')?.label).toBe(
    'actions.markWatched',
  )
})

it('keeps an unknown personal mark disabled and ignores a read started before a successful PUT', async () => {
  const personal: MineTitlePersonal = {
    titleId: 'film',
    continuation: 'normal',
    note: null,
    notInterested: false,
    status: 'watched',
    seen: { title: true, episode: null },
    cycle: null,
  }
  let finish!: (value: MineTitlePersonal) => void
  mocks.personal.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  mocks.mine.mockResolvedValue({
    status: null,
    collections: [],
    watchlist: false,
    favorite: false,
    rating: null,
  })
  mocks.put.mockImplementation(
    async (_id: string, body: { watched: boolean }) => ({
      ...personal,
      seen: { title: body.watched, episode: null },
    }),
  )
  const vm = mountSubject()
  openTitleActions({ id: 'film', title: 'Fictional film', kind: 'movie' })
  await Promise.resolve()
  await nextTick()
  expect(vm.mainOptions.find(row => row.id === 'watched')?.disabled).toBe(
    true,
  )
  await vm.toggleWatched()
  expect(mocks.put).not.toHaveBeenCalled()
  finish(personal)
  await Promise.resolve()
  await nextTick()
  expect(vm.mainOptions.find(row => row.id === 'watched')?.label).toBe(
    'actions.unmarkWatched',
  )

  // A refresh may still be in flight when the user issues a newer mutation.
  mocks.personal.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const pending = vm.loadPersonal('film', vm.loadToken)
  await vm.toggleWatched()
  expect(mocks.put.mock.calls.map(([, body]) => body.watched)).toEqual([false])
  finish(personal)
  await pending
  expect(vm.mainOptions.find(row => row.id === 'watched')?.label).toBe(
    'actions.markWatched',
  )
})
