import {
  createRenderer,
  defineComponent,
  h,
  nextTick,
  ref,
  ssrContextKey,
} from 'vue'
import { beforeEach, expect, it, vi } from 'vitest'
import ResolvePage from './ResolvePage.vue'

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  progress: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  diagnostic: vi.fn(),
  onKey: vi.fn(),
}))
vi.mock('../api.ts', () => ({
  api: { titles: { getTitleProgress: mocks.progress } },
}))
vi.mock('../composables/resolveEpisode.ts', () => ({
  resolveEpisode: mocks.resolve,
}))
vi.mock('../diagnostics/index.ts', () => ({
  currentDiagnosticContext: () => ({
    actionId: 'action-0001',
    clientSessionId: 'session-001',
  }),
  diagnostic: mocks.diagnostic,
  diagnosticParams: () => ({}),
}))
vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: mocks.replace }),
}))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('../composables/useCatalogLanguage.ts', () => ({
  useCatalogLanguage: () => ref('en'),
}))
vi.mock('../composables/usePlayerArt.ts', () => ({
  usePlayerArt: () => ({ art: ref(), subtitle: ref('') }),
}))
vi.mock('../focus/index.ts', () => ({
  useFocus: () => ({ onKey: mocks.onKey }),
}))
vi.mock('../lib/navigation.ts', () => ({ goBack: mocks.back }))
vi.mock('../components/player/PlayerStage.vue', () => ({
  default: defineComponent({
    setup:
      (_, { slots }) =>
        () =>
          h('div', slots.default?.()),
  }),
}))
vi.mock('../components/player/PlayerPrompt.vue', () => ({
  default: defineComponent({ setup: () => () => null }),
}))
vi.mock('../components/player/PlayerLamp.vue', () => ({
  default: defineComponent({ setup: () => () => null }),
}))
vi.mock('../components/player/PlayerBuffering.vue', () => ({
  default: defineComponent({ setup: () => () => null }),
}))

// Vue's real lifecycle runs against a minimal host; no browser or test-only lifecycle helper.
interface Element {
  children: Element[]
  parent: Element | null
}
function element(): Element {
  return { children: [], parent: null }
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
    node.parent = parent
    parent.children.push(node)
  },
  remove(node) {
    if (node.parent) {
      node.parent.children = node.parent.children.filter(
        child => child !== node,
      )
    }
  },
})
async function settle() {
  for (let i = 0; i < 6; i++) await nextTick()
}
async function mount(props = {}) {
  const app = renderer.createApp(
    { ...ResolvePage, render: () => null },
    { id: 'tmdb:tv:100', season: '1', episode: '2', ...props },
  )
  app.provide(ssrContextKey, {})
  app.mount(element())
  await settle()
  return app
}
function cancellations() {
  return mocks.diagnostic.mock.calls.filter(
    ([event]) => event.event === 'operation.cancelled',
  )
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.progress.mockResolvedValue({ seasonReleases: [] })
  mocks.onKey.mockReturnValue(() => {})
})

it('does not cancel a successful resolve when navigation unmounts the screen', async () => {
  mocks.resolve.mockResolvedValue({
    kind: 'found',
    file: { torrentId: 'torrent001', fileIndex: 2 },
  })
  const app = await mount()
  expect(mocks.replace).toHaveBeenCalledOnce()
  expect(mocks.replace.mock.calls[0]![0].state.diagnostic.actionId).toBe(
    'action-0001',
  )
  app.unmount()
  expect(cancellations()).toEqual([])
})
it.each([{}, { noSources: true }])(
  'does not cancel a completed unsuccessful resolve %o',
  async (result) => {
    mocks.resolve.mockResolvedValue({ kind: 'notFound', ...result })
    const app = await mount()
    app.unmount()
    expect(mocks.replace).not.toHaveBeenCalled()
    expect(cancellations()).toEqual([])
  },
)
it('records Back once and ignores the real resolver cancellation after unmount', async () => {
  const reply = Promise.withResolvers<void>()
  mocks.resolve.mockImplementation(async (_target, options) => {
    await reply.promise
    return options.cancelled()
      ? { kind: 'cancelled' }
      : { kind: 'found', file: { torrentId: 'torrent001', fileIndex: 2 } }
  })
  const app = await mount()
  const onKey = mocks.onKey.mock.calls[0]![0]
  expect(onKey({ type: 'back' })).toBe(true)
  expect(mocks.back).toHaveBeenCalledOnce()
  app.unmount()
  reply.resolve()
  await settle()
  expect(mocks.replace).not.toHaveBeenCalled()
  expect(cancellations()).toEqual([
    [
      { event: 'operation.cancelled', reason: 'back' },
      expect.objectContaining({ actionId: 'action-0001' }),
      true,
    ],
  ])
})
it('records an actual pending unmount once', async () => {
  mocks.resolve.mockReturnValue(new Promise(() => {}))
  const app = await mount()
  app.unmount()
  expect(cancellations()).toHaveLength(1)
  expect(cancellations()[0]![0].reason).toBe('unmounted')
})

it.each([true, false])(
  'keeps player source ahead of history with continuation metadata: %s',
  async (modern) => {
    mocks.progress.mockResolvedValue({
      seasonReleases: [
        {
          season: 1,
          torrentId: 'old-pack',
          episodes: [1, 2],
          voice: { studio: 'Old Studio' },
        },
      ],
      ...(modern && {
        continuation: {
          preferredTorrent: { torrentId: 'old-pack', fileIndex: 1 },
        },
      }),
    })
    mocks.resolve.mockResolvedValue({
      kind: 'found',
      file: { torrentId: 'new-pack', fileIndex: 1 },
    })
    const app = await mount({
      torrent: 'new-pack',
      voice: 'New Studio',
      automatic: { kind: 'continuation' },
    })
    const options = mocks.resolve.mock.calls[0]![1]
    expect(options.torrents.filter(Boolean)).toEqual(['new-pack', 'old-pack'])
    expect(options.voiceKey).toBe('studio:New Studio')
    expect(mocks.replace.mock.calls[0]![0].query).toMatchObject({
      voice: 'New Studio',
      automatic: '1',
    })
    app.unmount()
  },
)

it('leaves Home continuation preference ahead of factual history', async () => {
  mocks.progress.mockResolvedValue({
    seasonReleases: [{ season: 1, torrentId: 'short-preview', episodes: [2] }],
    continuation: {
      preferredTorrent: { torrentId: 'watched-pack', fileIndex: 1 },
    },
  })
  mocks.resolve.mockResolvedValue({ kind: 'notFound' })
  const app = await mount({ automatic: { kind: 'continuation' } })
  expect(mocks.resolve.mock.calls[0]![1].torrents.filter(Boolean)).toEqual([
    'watched-pack',
  ])
  app.unmount()
})
