import type { Component } from 'vue'
import type { SourceCandidate } from '@torsher/api-client'
import type { SourceChoice } from '../components/SourcesScreen.vue'
import {
  createRenderer,
  h,
  KeepAlive,
  nextTick,
  ref,
  ssrContextKey,
} from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import SourcesPage from './SourcesPage.vue'

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  push: vi.fn(),
  back: vi.fn(),
  body: vi.fn(),
  select: (_id: string) => {},
  backScreen: () => {},
  library: () => {},
  opening: () => undefined as string | undefined,
  message: (): string => '',
}))
vi.mock('../api.ts', () => ({
  api: { titles: { postTitleOpen: mocks.open } },
}))
vi.mock('@torsher/api-client', () => ({
  getErrorStatus: () => 422,
  getErrorBody: mocks.body,
}))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: mocks.push }) }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('../lib/navigation.ts', () => ({ goBack: mocks.back }))
vi.mock('../diagnostics/index.ts', () => ({
  activationTrigger: () => 'pointer',
  diagnostic: vi.fn(),
  diagnosticAction: () => ({}),
  diagnosticParams: () => ({}),
  diagnosticRoute: (route: unknown) => route,
}))
// The node test environment does not render child UI components.
vi.mock('../components/SourcesScreen.vue', () => ({ default: {} }))
vi.mock('../components/AppToast.vue', () => ({ default: {} }))

interface Element {
  children: Element[]
  parent: Element | null
}
function element(): Element {
  return { children: [], parent: null }
}
function remove(node: Element) {
  if (node.parent) {
    node.parent.children = node.parent.children.filter(
      child => child !== node,
    )
  }
}
const renderer = createRenderer<Element, Element>({
  createElement: element,
  createText: element,
  createComment: element,
  setText() {},
  setElementText() {},
  patchProp() {},
  parentNode: node => node.parent,
  nextSibling: () => null,
  insert(node, parent) {
    remove(node)
    node.parent = parent
    parent.children.push(node)
  },
  remove,
})
async function settle() {
  for (let i = 0; i < 8; i++) await nextTick()
}
let cleanup: () => void
async function mount(props = {}) {
  const visible = ref(true)
  // Vitest compiles SFC templates for SSR;
  // exercise the real setup and lifecycle
  // with a render adapter that exposes the screen's existing event handlers.
  const page = {
    ...SourcesPage,
    render(
      _ctx: unknown,
      _cache: unknown,
      _props: unknown,
      setup: {
        open: (
          candidate: SourceCandidate,
          choice: SourceChoice,
        ) => Promise<void>
        back: () => void
        playLibrary: (id: string, title: object) => void
        opening?: string
        openError: string
      },
    ) {
      mocks.select = (id) => {
        void setup.open(
          { id } as SourceCandidate,
          { query: 'film', season: 2 } as SourceChoice,
        )
      }
      mocks.backScreen = setup.back
      mocks.library = () => setup.playLibrary('local-file', {})
      mocks.opening = () => setup.opening
      mocks.message = () => setup.openError
      return null
    },
  }
  const app = renderer.createApp({
    render: () =>
      h(KeepAlive, () =>
        visible.value
          ? h(page as Component, { id: 'tmdb:movie:1', ...props })
          : null),
  })
  app.provide(ssrContextKey, {})
  app.mount(element())
  cleanup = () => app.unmount()
  await settle()
  return { visible, app }
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.body.mockResolvedValue({ kind: 'candidate_gone' })
})
afterEach(() => cleanup?.())

it('opens the selected source once and keeps its season', async () => {
  const reply = Promise.withResolvers<{ torrentId: string }>()
  mocks.open.mockReturnValue(reply.promise)
  await mount()
  mocks.select('first')
  mocks.select('second')
  await settle()
  expect(mocks.open).toHaveBeenCalledOnce()
  expect(mocks.opening()).toBe('first')
  reply.resolve({ torrentId: 'torrent' })
  await settle()
  expect(mocks.push).toHaveBeenCalledWith(
    expect.objectContaining({
      path: '/title/tmdb:movie:1/files/torrent',
      query: { season: '2', download: undefined },
    }),
  )
  expect(mocks.opening()).toBeUndefined()
})
it.each(['back', 'deactivate', 'unmount', 'library'] as const)(
  'ignores a late successful opening after %s',
  async (leave) => {
    const reply = Promise.withResolvers<{ torrentId: string }>()
    mocks.open.mockReturnValue(reply.promise)
    const { visible, app } = await mount()
    mocks.select('first')
    if (leave === 'back')
      mocks.backScreen()
    if (leave === 'deactivate')
      visible.value = false
    if (leave === 'unmount') {
      app.unmount()
      cleanup = () => {}
    }
    if (leave === 'library')
      mocks.library()
    await settle()
    mocks.push.mockClear()
    reply.resolve({ torrentId: 'stale' })
    await settle()
    expect(mocks.push).not.toHaveBeenCalled()
    if (leave === 'back')
      expect(mocks.back).toHaveBeenCalledOnce()
  },
)
it.each(['success', 'failure'] as const)(
  'keeps a new request intact when the old one ends with %s after returning',
  async (outcome) => {
    const old = Promise.withResolvers<{ torrentId: string }>()
    const current = Promise.withResolvers<{ torrentId: string }>()
    mocks.open
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(current.promise)
    const { visible } = await mount()
    mocks.select('first')
    visible.value = false
    await settle()
    visible.value = true
    await settle()
    expect(mocks.opening()).toBeUndefined()
    mocks.select('second')
    if (outcome === 'success')
      old.resolve({ torrentId: 'old' })
    else old.reject(new Error('gone'))
    await settle()
    expect(mocks.opening()).toBe('second')
    expect(mocks.message()).toBe('')
    expect(mocks.push).not.toHaveBeenCalled()
    current.resolve({ torrentId: 'new' })
    await settle()
    expect(mocks.push).toHaveBeenCalledOnce()
    expect(mocks.push.mock.calls[0]![0].path).toContain('/files/new')
  },
)
it('ignores an error body that finishes reading after Back', async () => {
  const body = Promise.withResolvers<{ kind: string }>()
  mocks.body.mockReturnValue(body.promise)
  mocks.open.mockRejectedValue(new Error('gone'))
  await mount()
  mocks.select('first')
  await settle()
  expect(mocks.body).toHaveBeenCalledOnce()
  mocks.backScreen()
  body.resolve({ kind: 'candidate_gone' })
  await settle()
  expect(mocks.message()).toBe('')
})
it('shows an active error and allows another attempt', async () => {
  mocks.open.mockRejectedValue(new Error('gone'))
  await mount()
  mocks.select('first')
  await settle()
  expect(mocks.message()).toBe('watch.errors.gone')
  expect(mocks.opening()).toBeUndefined()
  mocks.select('second')
  await settle()
  expect(mocks.open).toHaveBeenCalledTimes(2)
})
it('keeps episode selection on the resolver path', async () => {
  await mount({ season: '2', episode: '3' })
  mocks.select('first')
  expect(mocks.open).not.toHaveBeenCalled()
  expect(mocks.push).toHaveBeenCalledWith(
    expect.objectContaining({
      query: expect.objectContaining({ candidate: 'first', q: 'film' }),
    }),
  )
})
