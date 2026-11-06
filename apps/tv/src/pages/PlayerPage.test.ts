import type { Ref } from 'vue'
import type { PlaybackRestart } from '../composables/usePlayback.ts'
import { createRenderer, nextTick, ref, ssrContextKey } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import PlayerPage from './PlayerPage.vue'

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  play: vi.fn(),
  pause: vi.fn(),
  attach: vi.fn(),
  native: false,
  restart: (_change: PlaybackRestart): Promise<void> => Promise.resolve(),
  media: undefined as unknown as HTMLVideoElement,
}))
vi.mock('../api.ts', () => ({ api: {} }))
vi.mock('../session.ts', () => ({
  session: {},
  updatePlayerSettings: vi.fn(),
}))
vi.mock('../serverSources.ts', () => ({ lacksSources: () => true }))
vi.mock('../platform/android.ts', () => ({
  get hasNativePlayer() {
    return mocks.native
  },
}))
vi.mock('../platform/nativeVideo.ts', () => ({
  attachNativeVideo: () => () => {},
}))
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))
vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: ref('en') }),
}))
vi.mock('../focus/index.ts', () => ({
  useFocus: () => ({
    onKey: () => () => {},
    activate: vi.fn(),
    current: () => null,
  }),
}))
vi.mock('../diagnostics/index.ts', () => ({
  activationTrigger: () => 'pointer',
  currentDiagnosticContext: () => ({}),
  diagnostic: vi.fn(),
  diagnosticAction: () => ({}),
  diagnosticError: vi.fn(),
  diagnosticMedia: () => () => {},
  diagnosticParams: () => ({}),
  diagnosticRoute: (route: unknown) => route,
  diagnosticSnapshot: vi.fn(),
}))
vi.mock('../composables/useCatalogLanguage.ts', () => ({
  useCatalogLanguage: () => ref('en'),
}))
vi.mock('../composables/usePlayerArt.ts', () => ({
  usePlayerArt: () => ({
    art: ref(),
    episodeOverview: ref(),
    subtitle: ref(''),
    reload: vi.fn(),
  }),
}))
vi.mock('../composables/useHls.ts', () => ({
  useHls: () => ({
    attach: mocks.attach,
    detach: vi.fn(),
    diagnosticState: () => ({}),
  }),
}))
let mode = 'direct'
vi.mock('../composables/usePlayback.ts', () => ({
  usePlayback: () => ({
    playback: ref({
      streamUrl: '/stream',
      mode,
      duration: 180,
      startPosition: 0,
    }),
    stats: ref(),
    pending: ref(),
    status: ref('ready'),
    error: ref(),
    engineKind: ref(),
    storage: ref(),
    start: mocks.start,
    pollStats: vi.fn(),
    stopStats: vi.fn(),
    close: vi.fn(),
    saveWatchState: vi.fn().mockResolvedValue(undefined),
  }),
}))
vi.mock('../composables/usePlayerTracks.ts', () => ({
  usePlayerTracks: (
    _playback: unknown,
    video: Ref<HTMLVideoElement | undefined>,
    _position: unknown,
    restart: typeof mocks.restart,
  ) => {
    video.value = mocks.media
    mocks.restart = restart
    return { selection: () => ({}), refresh: vi.fn() }
  },
}))

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
  remove() {},
})
interface Controls {
  onPause: () => void
  onPlay: () => void
  onPlaying: () => void
  onLoadedMetadata: () => void
  onTimeUpdate: () => void
  paused: boolean
  phase: string
}
let controls: Controls
let cleanup: () => void
async function settle() {
  for (let i = 0; i < 12; i++) await nextTick()
}
async function mount() {
  // SFCs are compiled for SSR in this test environment. Keep the real setup,
  // lifecycle and media handlers;
  // only the DOM and streaming transport are fakes.
  const app = renderer.createApp(
    {
      ...PlayerPage,
      render(_ctx: unknown, _cache: unknown, _props: unknown, setup: Controls) {
        controls = setup
        return null
      },
    },
    { torrentId: 'fixture', fileIndex: '0' },
  )
  app.provide(ssrContextKey, {})
  app.mount(element())
  cleanup = () => app.unmount()
  await settle()
  controls.onLoadedMetadata()
  controls.onPlaying()
  mocks.media.currentTime = 42
  controls.onTimeUpdate()
  await settle()
  mocks.play.mockClear()
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  vi.stubGlobal('history', { state: {} })
  vi.stubGlobal('document', {
    hidden: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
  vi.stubGlobal('window', { setTimeout, clearTimeout })
  mocks.native = false
  mocks.start.mockResolvedValue('ready')
  mocks.attach.mockResolvedValue(true)
  mocks.play.mockResolvedValue(undefined)
  mocks.media = {
    play: mocks.play,
    pause: mocks.pause.mockImplementation(() => controls.onPause()),
    currentTime: 0,
    duration: 180,
    readyState: 4,
    HAVE_METADATA: 1,
    ended: false,
    error: null,
    buffered: { length: 0 },
    removeAttribute: vi.fn(),
    load: vi.fn(),
  } as unknown as HTMLVideoElement
})
afterEach(() => {
  cleanup?.()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it.each(['direct', 'hls', 'native'])(
  'keeps a paused %s stream paused through audio and subtitle restarts',
  async (transport) => {
    mode = transport === 'direct' ? 'direct' : 'hls'
    mocks.native = transport === 'native'
    await mount()
    controls.onPause()
    for (const change of [{ audioStream: 2 }, { subtitleStream: 3 }]) {
      await mocks.restart(change)
      controls.onLoadedMetadata()
      await settle()
      expect(mocks.play).not.toHaveBeenCalled()
      expect(controls.paused).toBe(true)
      expect(controls.phase).toBe('playing')
      expect(mocks.media.currentTime).toBe(42)
      expect(mocks.start).toHaveBeenLastCalledWith({
        ...change,
        startPosition: 42,
      })
    }
    controls.onPlay()
    controls.onPlaying()
    await mocks.restart({ audioStream: 1 })
    expect(mocks.play).toHaveBeenCalledOnce()
  },
)
it('resumes an actively playing stream despite the internal pause during restart', async () => {
  mode = 'direct'
  await mount()
  await mocks.restart({ audioStream: 2 })
  expect(mocks.pause).toHaveBeenCalledOnce()
  expect(mocks.play).toHaveBeenCalledOnce()
})
it('retains a paused restart while a transient start failure is retried', async () => {
  mode = 'direct'
  await mount()
  controls.onPause()
  mocks.start.mockResolvedValueOnce('retry').mockResolvedValueOnce('ready')
  await mocks.restart({ audioStream: 2 })
  await vi.advanceTimersByTimeAsync(2000)
  await settle()
  expect(mocks.start).toHaveBeenCalledTimes(3)
  expect(mocks.play).not.toHaveBeenCalled()
  controls.onLoadedMetadata()
  expect(controls.paused).toBe(true)
})
