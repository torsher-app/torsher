import { createRenderer, h, nextTick, ref, ssrContextKey } from 'vue'
import { beforeEach, expect, it, vi } from 'vitest'
import { backAction } from '../lib/navigation.ts'
import FilesPage from './FilesPage.vue'
import SourcesPage from './SourcesPage.vue'
import type { Component } from 'vue'

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  attach: vi.fn(),
  files: vi.fn(),
}))

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: mocks.push,
    replace: mocks.replace,
    options: { history: { state: { back: '/title/movie/sources' } } },
  }),
}))
vi.mock('../api.ts', () => ({
  api: { titles: { postTitleOpen: mocks.attach, getTitleFiles: mocks.files } },
}))
vi.mock('../diagnostics/index.ts', () => ({
  activationTrigger: () => 'remote',
  currentDiagnosticContext: () => ({}),
  diagnostic: () => {},
  diagnosticAction: () => ({}),
  diagnosticParams: () => ({}),
  diagnosticPoll: () => ({ params: () => ({}), finish: () => {} }),
  diagnosticRoute: (route: object) => route,
}))
vi.mock('../components/SourcesScreen.vue', () => ({ default: {} }))
vi.mock('../components/FocusSection.vue', () => ({ default: {} }))
vi.mock('../composables/useCatalogLanguage.ts', () => ({
  useCatalogLanguage: () => ref('en-US'),
}))
vi.mock('../composables/useCatalogTitle.ts', () => ({
  useCatalogTitle: () => ({ title: ref() }),
}))
vi.mock('../composables/useSourceLabels.ts', () => ({
  useSourceLabels: () => ({ sizeLabel: () => '' }),
}))
vi.mock('../composables/useTitleDownload.ts', () => ({
  useDownloadTexts: () => ({}),
}))
vi.mock('../composables/useTitleSections.ts', () => ({ loadSeason: vi.fn() }))
vi.mock('../focus/index.ts', () => ({
  useFocus: () => ({ onKey: () => () => {} }),
}))

interface Node {
  children: Node[]
  parent?: Node
}
const node = (): Node => ({ children: [] })
const renderer = createRenderer<Node, Node>({
  createElement: node,
  createText: node,
  createComment: node,
  setText() {},
  setElementText() {},
  patchProp() {},
  parentNode: el => el.parent ?? null,
  nextSibling: () => null,
  insert(el, parent) {
    el.parent = parent
    parent.children.push(el)
  },
  remove(el) {
    if (el.parent)
      el.parent.children = el.parent.children.filter(child => child !== el)
  },
})

const restart = 'diary-movie-receipt'
let sources: {
  open: (candidate: object, choice: object) => Promise<void>
  playLibrary: (id: string, target: object) => void
}
function mount(
  page: typeof SourcesPage | typeof FilesPage,
  props: Record<string, unknown> = {},
) {
  // The node environment compiles SFC templates for SSR. Keep their real
  // setup/lifecycle; the adapter exposes the SourcesScreen callback boundary.
  const screen = {
    ...page,
    render(
      _ctx: unknown,
      _cache: unknown,
      _props: unknown,
      setup: typeof sources,
    ) {
      if (page === SourcesPage)
        sources = setup
      return null
    },
  }
  const app = renderer.createApp({
    render: () =>
      h(screen as Component, {
        id: 'movie',
        start: '0',
        restartRequest: restart,
        ...props,
      }),
  })
  app.provide(ssrContextKey, {})
  app.mount(node())
  return () => app.unmount()
}

async function settled() {
  for (let index = 0; index < 6; index++) await nextTick()
}

beforeEach(() => {
  vi.clearAllMocks()
})

it('carries the diary movie restart through a torrent and the one-file transition to the player', async () => {
  mocks.attach.mockResolvedValue({ torrentId: 'chosen-torrent' })
  mocks.files.mockResolvedValue({
    status: 'ready',
    name: 'Movie',
    files: [{ fileIndex: 0, season: null, episode: null }],
  })
  const source = mount(SourcesPage)
  await sources.open({ id: 'chosen-release' }, { query: { kind: 'movie' } })
  expect(mocks.push).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      path: '/title/movie/files/chosen-torrent',
      query: expect.objectContaining({ start: '0', restart }),
    }),
  )
  const { query } = mocks.push.mock.calls[0]![0]
  source()

  const files = mount(FilesPage, {
    torrentId: 'chosen-torrent',
    start: query.start,
    restartRequest: query.restart,
  })
  await settled()
  expect(mocks.replace).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      path: '/play/chosen-torrent/0',
      query: expect.objectContaining({ title: 'movie', start: '0', restart }),
    }),
  )
  files()
})

it('starts the selected library movie from the beginning and returns to the diary through source history', () => {
  const source = mount(SourcesPage)
  sources.playLibrary('movie-file', { season: null, episode: null })
  expect(mocks.push).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      path: '/play/library/movie-file',
      query: expect.objectContaining({ title: 'movie', start: '0', restart }),
    }),
  )
  expect(
    backAction(
      {
        pattern: '/title/:id/sources',
        params: { id: 'movie' },
        query: { start: '0', restart },
      },
      '/mine',
    ),
  ).toEqual({ kind: 'history' })
  source()
})

it('does not reuse an episode restart for a different library target', () => {
  const source = mount(SourcesPage, { season: '2', episode: '4' })
  sources.playLibrary('movie-file', { season: null, episode: null })
  const { query } = mocks.push.mock.calls[0]![0]
  expect(query?.start).toBeUndefined()
  expect(query?.restart).toBeUndefined()
  source()
})
