import type { SourceCandidate, TorrentStats } from '@torsher/api-client'
import type { SourceChoice } from '../components/SourcesScreen.vue'
import type { Ref } from 'vue'
import type { PlaybackRestart } from '../composables/usePlayback.ts'
import type { KeyAction } from '../focus/index.ts'
import type { MediaObservation } from '../diagnostics/support.ts'
import { createRenderer, nextTick, ref, ssrContextKey } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PAUSE_DIM_MS } from '../lib/player.ts'
import PlayerPage from './PlayerPage.vue'

const mocks = vi.hoisted(() => ({
  clockOffset: 0,
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
  appliedAudioStream: vi.fn(),
  progress: vi.fn(),
  upNext: vi.fn(),
  pollStats: vi.fn(),
  snapshot: vi.fn(),
  readMedia: undefined as (() => MediaObservation | undefined) | undefined,
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
  diagnosticMedia: (read: () => MediaObservation | undefined) => {
    mocks.readMedia = read
    return () => {
      mocks.readMedia = undefined
    }
  },
  diagnosticParams: () => ({}),
  diagnosticRoute: (route: unknown) => route,
  diagnosticSnapshot: mocks.snapshot,
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
    sourceTime: (time: number) => Math.max(0, time - mocks.clockOffset),
    mediaTime: (time: number) => Math.max(0, time + mocks.clockOffset),
  }),
}))
let mediaRef: Ref<HTMLVideoElement | undefined>
let mode = 'direct'
let reasons: string[] = []
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
      reasons,
      duration: 180,
      startPosition: 0,
    }),
    stats: playerStats,
    statsFailed,
    statsReceivedAt: () => statsAt.value,
    statsOffset: () => 40,
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
    mediaRef = video
    video.value = mocks.media
    mocks.restart = restart
    return {
      audioTrack: ref(undefined),
      selection: () => ({}),
      refresh: vi.fn(),
      resetAppliedAudio: vi.fn(),
      appliedAudioStream: mocks.appliedAudioStream,
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
  seekTo: (seconds: number) => void
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
  onWaiting: () => void
  onLoadedMetadata: () => void
  onTimeUpdate: () => void
  onPointer: (event: MouseEvent) => void
  osd: { visible: Ref<boolean>, dimmed: Ref<boolean> }
  paused: boolean
  phase: string
  panel: 'source' | null
  step: string
  slow: boolean
  bufferingSince: number
  stageStats: TorrentStats | undefined
  stageProgress: number
  stalledStatus: { step: string, connected?: number }
  osdStats: TorrentStats | undefined
  serverCache: NonNullable<TorrentStats['file']['playbackCache']> | null
  cacheSeconds: number | null
  bufferSeconds: number
}
let controls: Controls
let cleanup: () => void
async function settle() {
  for (let i = 0; i < 12; i++) await nextTick()
}
async function mount(playing = true, episodic = false, library = false) {
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
      ...(library
        ? { mediaFileId: 'library-file' }
        : { torrentId: 'fixture', fileIndex: '0' }),
      ...(library ? {} : { titleId: 'tmdb:tv:1' }),
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
  mocks.clockOffset = 0
  mode = 'direct'
  reasons = []
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
  mocks.appliedAudioStream.mockReturnValue(null)
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
    videoWidth: 854,
    videoHeight: 480,
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

it('samples media and stats together on waiting and recovery with the same playback session', async () => {
  await mount()
  await vi.advanceTimersByTimeAsync(500)
  controls.onPlaying()
  await settle()
  const observations: MediaObservation[] = []
  mocks.snapshot.mockImplementation(() =>
    observations.push(mocks.readMedia!()!),
  )
  const current: TorrentStats = {
    activity: 'downloading',
    downloadSpeed: 0,
    uploadSpeed: 0,
    badPieces: 0,
    peers: { connected: 1, seeders: 0, found: 10 },
    file: { size: 1000, downloaded: 500, bufferedAhead: 100 },
  }
  playerStats.value = current
  statsAt.value = Date.now()
  Object.defineProperty(mocks.media, 'buffered', {
    value: { length: 1, start: () => 40, end: () => 43 },
    configurable: true,
  })
  controls.onWaiting()
  await settle()
  await vi.advanceTimersByTimeAsync(5000)
  playerStats.value = {
    ...current,
    downloadSpeed: 5000,
    peers: { connected: 5, seeders: 2, found: 10 },
  }
  statsAt.value = Date.now()
  Object.defineProperty(mocks.media, 'buffered', {
    value: { length: 1, start: () => 40, end: () => 52 },
    configurable: true,
  })
  controls.onPlaying()
  await settle()
  expect(
    observations.map(o => [
      o.stalled,
      o.media.position,
      o.network?.stats.downloadBytesPerSecond,
      o.network?.clientBuffer.aheadSeconds,
    ]),
  ).toEqual([
    [true, 42, 0, 1],
    [false, 42, 5000, 10],
  ])
  expect(
    observations.every(o => o.context.session === 'playback-fixture'),
  ).toBe(true)
  expect(observations[0]!.network?.stats).toMatchObject({
    state: 'fresh',
    ageMs: 0,
    offsetBytes: 40,
    seedersConnected: 0,
  })
})

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
    file: {
      size: 100,
      downloaded: 100,
      bufferedAhead: 0,
      playbackCache: {
        sampledAtSeconds: 0,
        anchorOffset: 0,
        contiguousEndOffset: 100,
        bufferedUntilSeconds: 100,
        verifiedToEnd: true,
      },
    },
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
  mocks.clockOffset = 0
  mode = 'direct'
  reasons = []
  await mount()
  await mocks.restart({ audioStream: 2 })
  expect(mocks.pause).toHaveBeenCalledOnce()
  expect(mocks.play).toHaveBeenCalledOnce()
})
it('retains a paused restart while a transient start failure is retried', async () => {
  mocks.clockOffset = 0
  mode = 'direct'
  reasons = []
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
it('keeps the refined search query when switching to its selected source', async () => {
  await mount()
  await controls.switchSource(
    { id: 'refined-uhd', torrentId: null } as SourceCandidate,
    { query: 'Alternate title 2020' },
  )
  expect(mocks.replace).toHaveBeenCalledWith(
    expect.objectContaining({
      path: '/title/tmdb:tv:1/play',
      query: expect.objectContaining({
        candidate: 'refined-uhd',
        q: 'Alternate title 2020',
      }),
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
  mocks.clockOffset = 0
  mode = 'direct'
  reasons = []
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
  mocks.clockOffset = 0
  mode = 'direct'
  reasons = []
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

it('saves the former HLS session before a failed audio restart', async () => {
  mode = 'hls'
  await mount()
  mocks.media.currentTime = 38
  controls.onTimeUpdate()
  mocks.save.mockClear()
  mocks.start.mockResolvedValueOnce('error')
  await mocks.restart({ audioStream: 2 })
  expect(mocks.save).toHaveBeenCalledExactlyOnceWith(
    38,
    180,
    'checkpoint',
    expect.anything(),
    { sessionId: 'playback-fixture', appliedAudioStream: null },
  )
  controls.exit()
  expect(mocks.save).toHaveBeenCalledOnce()
})

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

it.each(['save', 'progress'] as const)(
  'ignores new and queued recovery while Next waits for %s',
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
    controls.recover('unknown')
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
    const starts = mocks.start.mock.calls.length
    controls.recover('unknown')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(mocks.start).toHaveBeenCalledTimes(starts)
    done()
    await next
    await settle()
    expect(mocks.replace).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ path: '/play/fixture/1' }),
    )
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

it('accepts a subsecond stats reply between clock ticks without flickering cache availability', async () => {
  await mount()
  await vi.advanceTimersByTimeAsync(500)
  statsAt.value = Date.now()
  playerStats.value = {
    activity: 'downloading',
    peers: { connected: 0, found: 0, seeders: 0 },
    downloadSpeed: 0,
    uploadSpeed: 0,
    badPieces: 0,
    file: {
      size: 1000,
      downloaded: 1000,
      bufferedAhead: 1000,
      playbackCache: {
        sampledAtSeconds: 42,
        anchorOffset: 0,
        contiguousEndOffset: 1000,
        bufferedUntilSeconds: 180,
        verifiedToEnd: true,
      },
    },
  }
  await settle()
  expect(controls.serverCache?.verifiedToEnd).toBe(true)
  expect(controls.cacheSeconds).toBe(138)
})

it('refreshes live player ranges while the playback position stays unchanged', async () => {
  await mount()
  Object.defineProperty(mocks.media, 'buffered', {
    value: { length: 1, start: () => 40, end: () => 43 },
    configurable: true,
  })
  await vi.advanceTimersByTimeAsync(1000)
  expect(controls.bufferSeconds).toBe(1)
  Object.defineProperty(mocks.media, 'buffered', {
    value: { length: 1, start: () => 40, end: () => 52 },
    configurable: true,
  })
  await vi.advanceTimersByTimeAsync(1000)
  expect(controls.bufferSeconds).toBe(10)
})

const displayedSample: TorrentStats = {
  activity: 'downloading',
  downloadSpeed: 0,
  uploadSpeed: 0,
  badPieces: 0,
  peers: { connected: 6, found: 40, seeders: 6 },
  file: { size: 1000, downloaded: 1000, bufferedAhead: 0 },
}

it('retracts slow and peer claims together in preparation and stalled status after failure or expiry', async () => {
  await mount(false)
  playerStats.value = displayedSample
  statsAt.value = Date.now()
  controls.slow = true
  await settle()
  expect(controls.step).toBe('slow')
  expect(controls.stageStats).toEqual(displayedSample)
  expect(controls.stalledStatus).toEqual({ step: 'slow', connected: 6 })
  statsFailed.value = true
  await settle()
  expect(controls.osdStats).toBeUndefined()
  expect(controls.stageStats).toBeUndefined()
  expect(controls.stalledStatus).toEqual({
    step: 'reconnecting',
    connected: undefined,
  })
  statsFailed.value = false
  statsAt.value = Date.now()
  await settle()
  expect(controls.stalledStatus).toEqual({ step: 'slow', connected: 6 })
  await vi.advanceTimersByTimeAsync(16_000)
  expect(controls.step).toBe('reconnecting')
  expect(controls.stageStats).toBeUndefined()
  expect(controls.stalledStatus).toEqual({
    step: 'reconnecting',
    connected: undefined,
  })
  statsAt.value = Date.now()
  await settle()
  expect(controls.osdStats).toEqual(displayedSample)
  expect(controls.stageStats).toEqual(displayedSample)
})

it('uses exact response age and never rejuvenates old stats when preparation restarts', async () => {
  await mount(false)
  await vi.advanceTimersByTimeAsync(500)
  playerStats.value = displayedSample
  statsAt.value = Date.now()
  await settle()
  expect(controls.osdStats).toEqual(displayedSample)
  expect(controls.stageStats).toEqual(displayedSample)
  statsAt.value = Date.now() - 15_000
  await settle()
  expect(controls.osdStats).toEqual(displayedSample)
  statsAt.value = Date.now() - 15_001
  controls.bufferingSince = Date.now()
  await settle()
  expect(controls.osdStats).toBeUndefined()
  expect(controls.step).toBe('reconnecting')
  for (const received of [
    0,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Date.now() + 1,
  ]) {
    statsAt.value = received
    await settle()
    expect(controls.osdStats).toBeUndefined()
    expect(controls.step).toBe('reconnecting')
  }
})

it('waits for the first sample then reconnects and never calls idle or invalid peers slow', async () => {
  await mount(false)
  expect(controls.step).toBe('connecting')
  expect(controls.stageStats).toBeUndefined()
  await vi.advanceTimersByTimeAsync(15_000)
  expect(controls.step).toBe('reconnecting')
  playerStats.value = { ...displayedSample, activity: 'idle' }
  statsAt.value = Date.now()
  controls.slow = true
  await settle()
  expect(controls.step).toBe('connecting')
  expect(controls.stalledStatus.connected).toBeUndefined()
  for (const connected of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    playerStats.value = {
      ...displayedSample,
      peers: { connected, found: Number.NaN, seeders: 6 },
    }
    await settle()
    expect(controls.step).toBe('connecting')
    expect(controls.stalledStatus.step).toBe('buffering')
  }
})

it('keeps invalid downloaded bytes out of decorative lamp intensity', async () => {
  await mount(false)
  statsAt.value = Date.now()
  for (const downloaded of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
    playerStats.value = {
      ...displayedSample,
      file: { ...displayedSample.file, downloaded },
    }
    await settle()
    expect(controls.stageProgress).toBe(0)
  }
})

it('does not preserve a slow diagnosis after the current poll fails', async () => {
  await mount(false)
  playerStats.value = displayedSample
  statsAt.value = Date.now()
  controls.slow = true
  await settle()
  expect(controls.step).toBe('slow')
  statsFailed.value = true
  await settle()
  expect(controls.step).toBe('reconnecting')
})

it('keeps library preparation neutral without torrent counters after fifteen seconds', async () => {
  await mount(false, false, true)
  controls.slow = true
  await vi.advanceTimersByTimeAsync(16_000)
  expect(controls.step).toBe('buffering')
  expect(controls.osdStats).toBeUndefined()
  expect(controls.stageStats).toBeUndefined()
  expect(controls.stalledStatus).toEqual({
    step: 'buffering',
    connected: undefined,
  })
})

it('gives a seek its own first-response grace without rejuvenating an old measurement', async () => {
  await mount()
  await vi.advanceTimersByTimeAsync(16_000)
  mocks.pollStats.mockImplementationOnce(() => {
    playerStats.value = undefined
    statsAt.value = 0
    statsFailed.value = false
  })
  controls.seekTo(60)
  controls.onWaiting()
  await settle()
  expect(controls.step).toBe('connecting')
  expect(controls.stalledStatus).toEqual({
    step: 'buffering',
    connected: undefined,
  })
  expect(controls.osdStats).toBeUndefined()
  await vi.advanceTimersByTimeAsync(14_000)
  expect(controls.step).toBe('connecting')
  await vi.advanceTimersByTimeAsync(1_000)
  expect(controls.step).toBe('reconnecting')
  playerStats.value = displayedSample
  statsAt.value = Date.now()
  await settle()
  expect(controls.stalledStatus).toEqual({ step: 'buffering', connected: 6 })
})

it.each(['exit', 'unmount'] as const)(
  'ignores late media updates after %s and preserves the exit checkpoint',
  async (cancel) => {
    await mount()
    mocks.media.currentTime = 73
    controls.onTimeUpdate()
    mocks.save.mockClear()
    mocks.appliedAudioStream.mockReturnValue(2)
    mocks.detach.mockImplementation(() =>
      mocks.appliedAudioStream.mockReturnValue(null),
    )
    if (cancel === 'exit')
      controls.exit()
    else cleanup()
    expect(mocks.save).toHaveBeenLastCalledWith(
      73,
      180,
      cancel === 'exit' ? 'exit' : 'checkpoint',
      expect.anything(),
      { sessionId: 'playback-fixture', appliedAudioStream: 2 },
    )
    mocks.save.mockClear()

    // Teardown can queue events before Vue clears the template ref.
    mocks.media.currentTime = 0
    Object.assign(mocks.media, { duration: Number.NaN })
    controls.onTimeUpdate()
    controls.onLoadedMetadata()
    // Detached DOM listeners can also fire after Vue has cleared the ref.
    for (const value of [null, undefined]) {
      Object.assign(mediaRef, { value })
      expect(() => controls.onTimeUpdate()).not.toThrow()
      expect(() => controls.onLoadedMetadata()).not.toThrow()
    }
    expect(mocks.save).not.toHaveBeenCalled()
    if (cancel === 'exit') {
      cleanup()
      expect(mocks.save).not.toHaveBeenCalled()
    }
  },
)

it('rejects an audio-only direct fallback without saving false video progress', async () => {
  reasons = ['ToolsMissing']
  Object.assign(mocks.media, { videoWidth: 0, videoHeight: 0 })
  await mount(true, false, true)
  expect(mocks.fail).not.toHaveBeenCalled()
  expect(mocks.save).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(5100)
  controls.onTimeUpdate()
  expect(mocks.fail).toHaveBeenCalledWith('unsupported', expect.any(Object))
  expect(mocks.pause).toHaveBeenCalled()
  controls.exit()
  expect(mocks.save).not.toHaveBeenCalled()
})

it('rejects a short ToolsMissing EOF with no picture before accepting completion', async () => {
  reasons = ['ToolsMissing']
  Object.assign(mocks.media, { videoWidth: 0, videoHeight: 0 })
  await mount(true, false, true)
  Object.assign(mocks.media, { currentTime: 2, duration: 2, ended: true })
  controls.onEnded()
  expect(mocks.fail).toHaveBeenCalledWith('unsupported', expect.any(Object))
  expect(mocks.save).not.toHaveBeenCalled()
})

it('allows delayed video dimensions and saves compatible direct playback without ffmpeg', async () => {
  reasons = ['ToolsMissing']
  Object.assign(mocks.media, { videoWidth: 0, videoHeight: 0 })
  await mount(true, false, true)
  expect(mocks.save).not.toHaveBeenCalled()
  Object.assign(mocks.media, { videoWidth: 854, videoHeight: 480 })
  await vi.advanceTimersByTimeAsync(5100)
  controls.onTimeUpdate()
  expect(mocks.fail).not.toHaveBeenCalled()
  expect(mocks.save).toHaveBeenCalled()
  Object.assign(mocks.media, { currentTime: 180, ended: true })
  controls.onEnded()
  expect(mocks.fail).not.toHaveBeenCalled()
})

it('does not require HTML dimensions from the Android native player bridge', async () => {
  reasons = ['ToolsMissing']
  mocks.native = true
  Object.assign(mocks.media, { videoWidth: 0, videoHeight: 0 })
  await mount(true, false, true)
  await vi.advanceTimersByTimeAsync(5100)
  controls.onTimeUpdate()
  expect(mocks.fail).not.toHaveBeenCalled()
  expect(mocks.save).toHaveBeenCalled()
})

it('starts a fresh picture grace period after retrying the same file', async () => {
  reasons = ['ToolsMissing']
  Object.assign(mocks.media, { videoWidth: 0, videoHeight: 0 })
  await mount(true, false, true)
  await vi.advanceTimersByTimeAsync(5100)
  controls.onTimeUpdate()
  expect(mocks.fail).toHaveBeenCalledOnce()
  mocks.fail.mockClear()
  await controls.start()
  controls.onPlaying()
  controls.onTimeUpdate()
  expect(mocks.fail).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(5100)
  controls.onTimeUpdate()
  expect(mocks.fail).toHaveBeenCalledOnce()
})

it('saves HLS progress in source time and bounds packet padding by source duration', async () => {
  mode = 'hls'
  mocks.clockOffset = 2
  Object.defineProperty(mocks.media, 'duration', {
    value: 182.05,
    configurable: true,
  })
  await mount()
  mocks.media.currentTime = 102
  controls.onTimeUpdate()
  expect(mocks.save).toHaveBeenLastCalledWith(
    100,
    180,
    'checkpoint',
    expect.anything(),
    { sessionId: 'playback-fixture', appliedAudioStream: null },
  )
  mocks.media.currentTime = 32
  controls.onTimeUpdate()
  expect(mocks.save).toHaveBeenLastCalledWith(
    30,
    180,
    'checkpoint',
    expect.anything(),
    { sessionId: 'playback-fixture', appliedAudioStream: null },
  )
  mocks.media.currentTime = 182.05
  controls.onTimeUpdate()
  expect(mocks.save).toHaveBeenLastCalledWith(
    180,
    180,
    'checkpoint',
    expect.anything(),
    { sessionId: 'playback-fixture', appliedAudioStream: null },
  )
})
