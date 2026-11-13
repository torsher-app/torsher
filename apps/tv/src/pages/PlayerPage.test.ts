import type { SourceCandidate, TorrentStats } from '@torsher/api-client'
import type { SourceChoice } from '../components/SourcesScreen.vue'
import type { Ref } from 'vue'
import type { PlaybackRestart } from '../composables/usePlayback.ts'
import type { KeyAction } from '../focus/index.ts'
import { createRenderer, nextTick, ref, ssrContextKey } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PAUSE_DIM_MS } from '../lib/player.ts'
import PlayerPage from './PlayerPage.vue'

const mocks = vi.hoisted(() => ({
  historyState: {} as Record<string, unknown>,
  goBack: vi.fn(),
  replace: vi.fn(),
  start: vi.fn(),
  saveTracks: vi.fn(),
  selectAudio: vi.fn(),
  selectSubtitles: vi.fn(),
  play: vi.fn(),
  pause: vi.fn(),
  focus: vi.fn(),
  attach: vi.fn(),
  detach: vi.fn(),
  fail: vi.fn(),
  save: vi.fn(),
  progress: vi.fn(),
  upNext: vi.fn(),
  pollStats: vi.fn(),
  native: false,
  restart: (_change: PlaybackRestart): Promise<void> => Promise.resolve(),
  media: undefined as unknown as HTMLVideoElement,
}))
vi.mock('../lib/navigation.ts', () => ({ goBack: mocks.goBack }))
vi.mock('../api.ts', () => ({
  api: {
    playback: { putPlaybackPreferences: mocks.saveTracks },
    titles: { getTitleProgress: mocks.progress, getTitleUpNext: mocks.upNext },
  },
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
    detach: mocks.detach,
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
    fail: mocks.fail,
    saveWatchState: mocks.save,
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
  start: () => Promise<void>
  exit: () => void
  recover: (cause?: 'unknown') => void
  playNext: () => Promise<void> | undefined
  onEnded: () => void
  switchSource: (
    candidate: SourceCandidate,
    choice: SourceChoice,
  ) => Promise<void>
  onTracksSelect: (id: string) => Promise<void>
  openPanel: (kind: 'audio' | 'subtitles' | 'source') => void
  closePanel: () => void
  onKey: (action: KeyAction, event: KeyboardEvent) => boolean
  onPause: () => void
  onPlay: () => void
  onPlaying: () => void
  onLoadedMetadata: () => void
  onTimeUpdate: () => void
  onPointer: (event: MouseEvent) => void
  osd: { visible: Ref<boolean>, dimmed: Ref<boolean> }
  paused: boolean
  phase: string
  panel: 'source' | null
  step: string
  osdStats: TorrentStats | undefined
}
let controls: Controls
let cleanup: () => void
async function settle() {
  for (let i = 0; i < 12; i++) await nextTick()
}
async function mount(playing = true, episodic = false) {
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
    {
      torrentId: 'fixture',
      fileIndex: '0',
      titleId: 'tmdb:tv:1',
      ...(episodic ? { season: '1', episode: '2' } : {}),
    },
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
  mode = 'direct'
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
  mocks.save.mockResolvedValue(undefined)
  mocks.progress.mockResolvedValue({ seasonReleases: [] })
  mocks.upNext.mockResolvedValue({ next: null })
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

function pointerMove(x = 100, y = 100) {
  controls.onPointer({
    type: 'mousemove',
    screenX: x,
    screenY: y,
  } as MouseEvent)
}

it('exits on the next Back after Sources closes despite stationary pointer events', async () => {
  await mount()
  pointerMove()
  controls.openPanel('source')
  controls.closePanel()

  controls.onKey({ type: 'back' }, {} as KeyboardEvent)
  expect(controls.osd.visible.value).toBe(false)
  pointerMove()
  expect(controls.osd.visible.value).toBe(false)
  controls.onKey({ type: 'back' }, {} as KeyboardEvent)
  expect(mocks.goBack).toHaveBeenCalledTimes(1)
})

it('shows controls when the pointer really moves after Back', async () => {
  await mount()
  pointerMove()
  controls.onKey({ type: 'back' }, {} as KeyboardEvent)
  expect(controls.osd.visible.value).toBe(false)

  pointerMove(101)
  expect(controls.osd.visible.value).toBe(true)
})

it('exits after hiding controls even when pointer movement shows them again', async () => {
  await mount()
  pointerMove()
  controls.onKey({ type: 'back' }, {} as KeyboardEvent)
  pointerMove(101)
  expect(controls.osd.visible.value).toBe(true)

  controls.onKey({ type: 'back' }, {} as KeyboardEvent)
  expect(mocks.goBack).toHaveBeenCalledOnce()
})

it('starts the Back sequence again after a deliberate pointer click', async () => {
  await mount()
  pointerMove()
  controls.onKey({ type: 'back' }, {} as KeyboardEvent)
  controls.onPointer({ type: 'click', target: null } as unknown as MouseEvent)

  controls.onKey({ type: 'back' }, {} as KeyboardEvent)
  expect(mocks.goBack).not.toHaveBeenCalled()
  expect(controls.osd.visible.value).toBe(false)
  controls.onKey({ type: 'back' }, {} as KeyboardEvent)
  expect(mocks.goBack).toHaveBeenCalledOnce()
})

it('starts the Back sequence again after another remote key', async () => {
  await mount()
  pointerMove()
  controls.onKey({ type: 'back' }, {} as KeyboardEvent)
  controls.onKey({ type: 'move', direction: 'up' }, {} as KeyboardEvent)

  controls.onKey({ type: 'back' }, {} as KeyboardEvent)
  expect(mocks.goBack).not.toHaveBeenCalled()
  expect(controls.osd.visible.value).toBe(false)
  controls.onKey({ type: 'back' }, {} as KeyboardEvent)
  expect(mocks.goBack).toHaveBeenCalledOnce()
})

it('closes a newly opened panel before hiding controls and exiting', async () => {
  await mount()
  pointerMove()
  controls.onKey({ type: 'back' }, {} as KeyboardEvent)
  pointerMove(101)
  controls.openPanel('source')

  controls.onKey({ type: 'back' }, {} as KeyboardEvent)
  expect(controls.panel).toBe(null)
  expect(mocks.goBack).not.toHaveBeenCalled()
  controls.onKey({ type: 'back' }, {} as KeyboardEvent)
  expect(mocks.goBack).not.toHaveBeenCalled()
  controls.onKey({ type: 'back' }, {} as KeyboardEvent)
  expect(mocks.goBack).toHaveBeenCalledOnce()
})

it('does not carry a dismissed controls step into a new playback launch', async () => {
  await mount()
  pointerMove()
  controls.onKey({ type: 'back' }, {} as KeyboardEvent)
  await controls.start()
  controls.onLoadedMetadata()
  controls.onPlaying()
  pointerMove(101)

  controls.onKey({ type: 'back' }, {} as KeyboardEvent)
  expect(mocks.goBack).not.toHaveBeenCalled()
  expect(controls.osd.visible.value).toBe(false)
  controls.onKey({ type: 'back' }, {} as KeyboardEvent)
  expect(mocks.goBack).toHaveBeenCalledOnce()
})

it('preserves a click at the same pointer coordinates after hiding controls', async () => {
  await mount()
  pointerMove()
  controls.onKey({ type: 'back' }, {} as KeyboardEvent)

  controls.onPointer({
    type: 'click',
    screenX: 100,
    screenY: 100,
    target: null,
  } as unknown as MouseEvent)
  expect(controls.osd.visible.value).toBe(true)
  expect(mocks.pause).toHaveBeenCalledTimes(1)
})

it('does not postpone hiding controls for stationary pointer events', async () => {
  await mount()
  pointerMove()
  await vi.advanceTimersByTimeAsync(3000)
  pointerMove()
  await vi.advanceTimersByTimeAsync(1001)
  expect(controls.osd.visible.value).toBe(false)
})

it('does not wake a dimmed pause until the pointer really moves', async () => {
  await mount()
  pointerMove()
  controls.onPause()
  await vi.advanceTimersByTimeAsync(PAUSE_DIM_MS + 1)
  expect(controls.osd.dimmed.value).toBe(true)

  pointerMove()
  expect(controls.osd.dimmed.value).toBe(true)
  expect(controls.osd.visible.value).toBe(false)
  pointerMove(100, 101)
  expect(controls.osd.dimmed.value).toBe(false)
  expect(controls.osd.visible.value).toBe(true)
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
    peers: { connected: 0, found: 0, seeders: 0 },
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
    peers: { connected: 0, found: 40, seeders: 0 },
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

it('hides failed or stale OSD stats and restores them after a successful poll', async () => {
  await mount()
  const fresh: TorrentStats = {
    activity: 'downloading',
    peers: { connected: 5, found: 20, seeders: 3 },
    downloadSpeed: 1_000_000,
    uploadSpeed: 0,
    badPieces: 0,
    file: { size: 1e9, downloaded: 1e8, bufferedAhead: 1e7 },
  }
  playerStats.value = fresh
  statsAt.value = Date.now()
  await settle()
  expect(controls.osdStats).toEqual(fresh)
  statsFailed.value = true
  await settle()
  expect(controls.osdStats).toBeUndefined()
  statsFailed.value = false
  await settle()
  expect(controls.osdStats).toEqual(fresh)
  await vi.advanceTimersByTimeAsync(16_000)
  expect(controls.osdStats).toBeUndefined()
  statsAt.value = Date.now()
  await settle()
  expect(controls.osdStats).toEqual(fresh)
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

it.each(['exit', 'unmount'] as const)(
  'does not autoplay after %s while HLS attaches',
  async (cancel) => {
    mode = 'hls'
    let attached!: (value: boolean) => void
    mocks.attach.mockImplementation(
      () =>
        new Promise((resolve) => {
          attached = resolve
        }),
    )
    await mount(false)
    mocks.detach.mockClear()
    if (cancel === 'exit')
      controls.exit()
    else cleanup()
    expect(mocks.detach).toHaveBeenCalledOnce()
    attached(true)
    await settle()
    expect(mocks.play).not.toHaveBeenCalled()
    expect(mocks.fail).not.toHaveBeenCalled()
  },
)

it('ignores a cancelled HLS attach result after exit instead of failing the closed player', async () => {
  mode = 'hls'
  let attached!: (value: boolean) => void
  mocks.attach.mockImplementation(
    () =>
      new Promise((resolve) => {
        attached = resolve
      }),
  )
  await mount(false)
  controls.exit()
  attached(false)
  await settle()
  expect(mocks.fail).not.toHaveBeenCalled()
  expect(mocks.play).not.toHaveBeenCalled()
})

it('does not begin a late audio restart after explicit exit', async () => {
  await mount()
  let ready!: (value: string) => void
  mocks.start.mockReturnValueOnce(
    new Promise((resolve) => {
      ready = resolve
    }),
  )
  const restarting = mocks.restart({ audioStream: 2 })
  controls.exit()
  ready('ready')
  await restarting
  expect(mocks.play).not.toHaveBeenCalled()
  expect(mocks.attach).not.toHaveBeenCalled()
  expect(mocks.goBack).toHaveBeenCalledOnce()
})

it('settles a rejected HLS attach after exit without playing or failing the closed page', async () => {
  mode = 'hls'
  await mount()
  let reject!: (reason: Error) => void
  mocks.attach.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail
      }),
  )
  const restart = mocks.restart({ audioStream: 2 })
  await settle()
  controls.exit()
  reject(new Error('chunk unavailable'))
  await expect(restart).resolves.toBeUndefined()
  expect(mocks.play).not.toHaveBeenCalled()
  expect(mocks.fail).not.toHaveBeenCalled()
})

it.each(['cancelled', 'rejected'] as const)(
  'keeps recovery retry alive when its pending HLS attach is %s',
  async (outcome) => {
    mode = 'hls'
    await mount()
    let attached!: (value: boolean) => void
    let rejected!: (reason: Error) => void
    mocks.attach.mockImplementationOnce(
      () =>
        new Promise((resolve, reject) => {
          attached = resolve
          rejected = reject
        }),
    )
    const restart = mocks.restart({ audioStream: 2 })
    await settle()
    controls.recover('unknown')
    if (outcome === 'cancelled')
      attached(false)
    else rejected(new Error('chunk unavailable'))
    await expect(restart).resolves.toBeUndefined()
    expect(mocks.fail).not.toHaveBeenCalled()
    expect(mocks.play).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2000)
    expect(mocks.start).toHaveBeenCalledTimes(3)
    expect(mocks.play).toHaveBeenCalledOnce()
    expect(mocks.fail).not.toHaveBeenCalled()
  },
)

it('ignores a late autoplay rejection during recovery and still resumes on retry', async () => {
  await mount()
  let rejected!: (reason: Error) => void
  mocks.play.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        rejected = reject
      }),
  )
  await mocks.restart({ audioStream: 2 })
  controls.recover('unknown')
  const pausedDuringRecovery = controls.paused
  const failure = new Error('gesture required')
  failure.name = 'NotAllowedError'
  rejected(failure)
  await settle()
  expect(controls.phase).toBe('buffering')
  expect(controls.paused).toBe(pausedDuringRecovery)
  expect(mocks.fail).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(2000)
  expect(mocks.start).toHaveBeenCalledTimes(3)
  expect(mocks.play).toHaveBeenCalledTimes(2)
  expect(controls.paused).toBe(false)
  expect(mocks.fail).not.toHaveBeenCalled()
})

it.each(['save', 'progress'] as const)(
  'preserves an agreed Next when natural ended arrives during %s',
  async (waiting) => {
    mocks.upNext.mockResolvedValue({
      next: {
        season: 1,
        episode: 3,
        title: 'Next',
        file: { torrentId: 'fixture', fileIndex: 1 },
      },
    })
    await mount(true, true)
    let done!: () => void
    const pending = new Promise<void>((resolve) => {
      done = resolve
    })
    if (waiting === 'save') {
      mocks.save.mockReturnValueOnce(pending)
    }
    else {
      mocks.progress.mockImplementationOnce(async () => {
        await pending
        return { seasonReleases: [] }
      })
    }
    const next = controls.playNext()
    await settle()
    expect(mocks.replace).not.toHaveBeenCalled()
    mocks.media.currentTime = mocks.media.duration
    controls.onEnded()
    done()
    await next
    await settle()
    expect(mocks.replace).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        path: '/play/fixture/1',
        query: expect.objectContaining({ season: '1', episode: '3' }),
      }),
    )
    expect(mocks.progress).toHaveBeenCalledOnce()
  },
)

it('explicit exit cancels an agreed Next while its progress lookup is pending', async () => {
  mocks.upNext.mockResolvedValue({
    next: {
      season: 1,
      episode: 3,
      title: 'Next',
      file: { torrentId: 'fixture', fileIndex: 1 },
    },
  })
  await mount(true, true)
  let done!: () => void
  mocks.progress.mockImplementationOnce(async () => {
    await new Promise<void>((resolve) => {
      done = resolve
    })
    return { seasonReleases: [] }
  })
  const next = controls.playNext()
  await settle()
  controls.exit()
  done()
  await next
  expect(mocks.goBack).toHaveBeenCalledOnce()
  expect(mocks.replace).not.toHaveBeenCalled()
})
