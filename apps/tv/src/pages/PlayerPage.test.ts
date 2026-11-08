import type { SourceCandidate, TorrentStats } from '@torsher/api-client'
import type { SourceChoice } from '../components/SourcesScreen.vue'
import type { Ref } from 'vue'
import type { PlaybackRestart } from '../composables/usePlayback.ts'
import { createRenderer, nextTick, ref, ssrContextKey } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import PlayerPage from './PlayerPage.vue'

const mocks = vi.hoisted(() => ({
  historyState: {} as Record<string, unknown>,
  replace: vi.fn(),
  start: vi.fn(),
  saveTracks: vi.fn(),
  selectAudio: vi.fn(),
  selectSubtitles: vi.fn(),
  play: vi.fn(),
  pause: vi.fn(),
  focus: vi.fn(),
  attach: vi.fn(),
  pollStats: vi.fn(),
  native: false,
  restart: (_change: PlaybackRestart): Promise<void> => Promise.resolve(),
  media: undefined as unknown as HTMLVideoElement,
}))
vi.mock('../api.ts', () => ({
  api: { playback: { putPlaybackPreferences: mocks.saveTracks } },
}))
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
  useRouter: () => ({
    push: vi.fn(),
    replace: mocks.replace,
    options: { history: { state: mocks.historyState } },
    currentRoute: ref({
      path: '/play/current/0',
      query: { title: 'tmdb:tv:100', season: '1', episode: '2' },
    }),
  }),
}))
vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: ref('en') }),
}))
vi.mock('../focus/index.ts', () => ({
  useFocus: () => ({
    onKey: () => () => {},
    activate: mocks.focus,
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
const playerStats = ref<TorrentStats>()
const statsFailed = ref(false)
const statsAt = ref(0)
const playerStatus = ref('ready')
vi.mock('../composables/usePlayback.ts', () => ({
  usePlayback: () => ({
    playback: ref({
      sessionId: 'playback-fixture',
      media: { audio: [], subtitles: [] },
      streamUrl: '/stream',
      mode,
      duration: 180,
      startPosition: 0,
    }),
    stats: playerStats,
    statsFailed,
    statsReceivedAt: () => statsAt.value,
    pending: ref(),
    status: playerStatus,
    error: ref(),
    engineKind: ref(),
    storage: ref(),
    start: mocks.start,
    pollStats: mocks.pollStats,
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
    return {
      audioTrack: ref(undefined),
      selection: () => ({}),
      refresh: vi.fn(),
      selectAudio: mocks.selectAudio,
      selectSubtitles: mocks.selectSubtitles,
    }
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
  switchSource: (
    candidate: SourceCandidate,
    choice: SourceChoice,
  ) => Promise<void>
  onTracksSelect: (id: string) => Promise<void>
  openPanel: (kind: 'audio' | 'subtitles' | 'source') => void
  closePanel: () => void
  onKey: (action: { type: 'back' }, event: KeyboardEvent) => boolean
  onPause: () => void
  onPlay: () => void
  onPlaying: () => void
  onLoadedMetadata: () => void
  onTimeUpdate: () => void
  paused: boolean
  phase: string
  panel: 'source' | null
  step: string
}
let controls: Controls
let cleanup: () => void
async function settle() {
  for (let i = 0; i < 12; i++) await nextTick()
}
async function mount(playing = true) {
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
    { torrentId: 'fixture', fileIndex: '0', titleId: 'tmdb:tv:1' },
  )
  app.provide(ssrContextKey, {})
  app.mount(element())
  cleanup = () => app.unmount()
  await settle()
  controls.onLoadedMetadata()
  if (playing)
    controls.onPlaying()
  mocks.media.currentTime = 42
  controls.onTimeUpdate()
  await settle()
  mocks.play.mockClear()
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  playerStats.value = undefined
  statsFailed.value = false
  statsAt.value = 0
  playerStatus.value = 'ready'
  mocks.historyState = {}
  vi.stubGlobal('history', { state: {} })
  vi.stubGlobal('document', {
    hidden: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
  vi.stubGlobal('window', { setTimeout, clearTimeout })
  mocks.saveTracks.mockResolvedValue({ saved: true })
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

it('polls while the initial probe is pending and distinguishes fresh zero peers from a failed poll', async () => {
  let finish!: (outcome: string) => void
  mocks.start.mockImplementation(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve
      }),
  )
  playerStatus.value = 'loading'
  await mount(false)
  expect(mocks.pollStats).toHaveBeenCalledTimes(1)
  expect(controls.phase).toBe('starting')
  await vi.advanceTimersByTimeAsync(16_000)
  playerStats.value = {
    activity: 'downloading',
    peers: { connected: 0, found: 0 },
    downloadSpeed: 0,
    uploadSpeed: 0,
    badPieces: 0,
    file: { size: 100, downloaded: 0, bufferedAhead: 0 },
  }
  statsAt.value = Date.now()
  await settle()
  expect(controls.step).toBe('waitingPeers')
  statsFailed.value = true
  await settle()
  expect(controls.step).toBe('reconnecting')
  statsFailed.value = false
  statsAt.value = Date.now()
  await settle()
  expect(controls.step).toBe('waitingPeers')
  playerStats.value = {
    ...playerStats.value!,
    peers: { connected: 0, found: 40 },
  }
  await settle()
  expect(controls.step).toBe('connectingPeers')
  playerStats.value = {
    ...playerStats.value!,
    file: { size: 100, downloaded: 100, bufferedAhead: 0 },
  }
  await settle()
  expect(controls.step).toBe('buffering')
  finish('ready')
  await settle()
  expect(mocks.pollStats).toHaveBeenCalledTimes(1)
})

it('restores the position and pause after cancelling a source switch', async () => {
  mocks.historyState = { resumePlayback: { position: 123.5, paused: true } }
  await mount(false)
  expect(mocks.start).toHaveBeenCalledWith({ startPosition: 123.5 })
  expect(controls.paused).toBe(true)
  expect(mocks.replace).toHaveBeenCalledWith({
    path: '/play/current/0',
    query: { title: 'tmdb:tv:100', season: '1', episode: '2' },
    state: { resumePlayback: null },
    force: true,
  })
})

it('consumes resume state even when the playback URL stays unchanged', async () => {
  const { createRouter, createMemoryHistory }
    = await vi.importActual<typeof import('vue-router')>('vue-router')
  const history = createMemoryHistory('/')
  const router = createRouter({
    history,
    routes: [{ path: '/play/:torrentId/:fileIndex', component: {} }],
  })
  const resumePlayback = { position: 123.5, paused: true }
  await router.push({
    path: '/play/current/0',
    query: { title: 'tmdb:tv:100', season: '1', episode: '2' },
    state: { resumePlayback },
  })
  expect(history.state.resumePlayback).toEqual(resumePlayback)
  const originalUrl = router.currentRoute.value.fullPath
  const replace = vi.spyOn(history, 'replace')
  mocks.historyState = history.state
  await mount(false)

  const result = await router.replace(mocks.replace.mock.calls[0]![0])

  expect(result).toBeUndefined()
  expect(replace).toHaveBeenCalledTimes(1)
  expect(history.state.resumePlayback).toBeNull()
  expect(router.currentRoute.value.fullPath).toBe(originalUrl)
  history.destroy()
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

it('saves explicit subtitle Off before applying it', async () => {
  await mount()
  controls.openPanel('subtitles')
  await controls.onTracksSelect('off')
  expect(mocks.saveTracks).toHaveBeenCalledWith('playback-fixture', {
    subtitle: null,
  })
  expect(mocks.selectSubtitles).toHaveBeenCalledWith('off')
})
it('does not apply a pending selection after Back and reopening the same panel', async () => {
  await mount()
  let saved!: () => void
  mocks.saveTracks.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        saved = resolve
      }),
  )
  controls.openPanel('audio')
  const pending = controls.onTracksSelect('3')
  await controls.onTracksSelect('2')
  controls.closePanel()
  controls.openPanel('audio')
  saved()
  await pending
  expect(mocks.saveTracks).toHaveBeenCalledOnce()
  expect(mocks.selectAudio).not.toHaveBeenCalled()
})
it('leaves a failed save unselected and allows retry', async () => {
  await mount()
  controls.openPanel('audio')
  mocks.saveTracks.mockRejectedValueOnce(new Error('offline'))
  await controls.onTracksSelect('3')
  expect(mocks.selectAudio).not.toHaveBeenCalled()
  await controls.onTracksSelect('3')
  expect(mocks.selectAudio).toHaveBeenCalledWith('3')
})

it('switches to a previous source even when history still labels it last watched', async () => {
  await mount()
  await controls.switchSource(
    {
      id: 'previous',
      torrentId: 'other',
      lastWatched: true,
    } as SourceCandidate,
    {},
  )
  expect(mocks.replace).toHaveBeenCalledWith(
    expect.objectContaining({
      path: '/title/tmdb:tv:1/play',
      query: expect.objectContaining({ candidate: 'previous' }),
    }),
  )
})
it('closes the source panel for the actual playing torrent even before history catches up', async () => {
  await mount()
  await controls.switchSource(
    {
      id: 'current',
      torrentId: 'fixture',
      lastWatched: false,
    } as SourceCandidate,
    {},
  )
  expect(mocks.replace).not.toHaveBeenCalled()
})
it('returns a resolved source switch to the source overlay once', async () => {
  mocks.historyState = { sourcePanelReturn: true }
  await mount(false)
  expect(controls.onKey({ type: 'back' }, {} as KeyboardEvent)).toBe(true)
  expect(controls.panel).toBe('source')
  expect(mocks.replace).toHaveBeenCalledWith({
    path: '/play/current/0',
    query: { title: 'tmdb:tv:100', season: '1', episode: '2' },
    state: { sourcePanelReturn: null },
    force: true,
  })

  mocks.replace.mockClear()
  expect(controls.onKey({ type: 'back' }, {} as KeyboardEvent)).toBe(true)
  expect(controls.panel).toBeNull()
  expect(mocks.replace).not.toHaveBeenCalled()
  expect(mocks.focus).toHaveBeenLastCalledWith('player-buttons')
  expect(controls.phase).toBe('playing')
  expect(controls.paused).toBe(true)

  controls.openPanel('source')
  await controls.switchSource(
    { id: 'another', torrentId: 'another' } as SourceCandidate,
    {},
  )
  expect(mocks.replace).toHaveBeenCalledWith(
    expect.objectContaining({
      path: '/title/tmdb:tv:1/play',
      query: expect.objectContaining({ candidate: 'another' }),
      state: expect.objectContaining({
        sourceReturn: expect.any(Object),
        sourcePanelReturn: null,
      }),
    }),
  )
})

it('leaves buffering on metadata after Sources paused a stream before its first frame', async () => {
  mode = 'direct'
  await mount(false)
  Object.assign(mocks.media, { readyState: 0 })
  controls.openPanel('source')
  controls.closePanel()
  expect(controls.phase).toBe('buffering')
  Object.assign(mocks.media, { readyState: 4 })
  controls.onLoadedMetadata()
  expect(controls.phase).toBe('playing')
  expect(controls.paused).toBe(true)
  expect(mocks.play).not.toHaveBeenCalled()
})

it('preserves the Sources pause while the playback request is still pending', async () => {
  mode = 'direct'
  let ready!: (value: string) => void
  mocks.start.mockImplementation(
    () =>
      new Promise((resolve) => {
        ready = resolve
      }),
  )
  await mount(false)
  controls.openPanel('source')
  controls.closePanel()
  ready('ready')
  await settle()
  controls.onLoadedMetadata()
  expect(controls.phase).toBe('playing')
  expect(controls.paused).toBe(true)
  expect(mocks.play).not.toHaveBeenCalled()
})

it('does not autoplay after Sources closes during an asynchronous HLS attach', async () => {
  mode = 'hls'
  let attached!: (value: boolean) => void
  mocks.attach.mockImplementation(
    () =>
      new Promise((resolve) => {
        attached = resolve
      }),
  )
  await mount(false)
  controls.openPanel('source')
  controls.closePanel()
  attached(true)
  await settle()
  expect(controls.phase).toBe('playing')
  expect(controls.paused).toBe(true)
  expect(mocks.play).not.toHaveBeenCalled()
})
