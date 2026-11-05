import { readFileSync } from 'node:fs'
import { shallowRef } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useContinuePlayback } from './useContinuePlayback.ts'

const { library, push, deactivate, unmount, diagnostic, action } = vi.hoisted(
  () => ({
    library: vi.fn(),
    diagnostic: vi.fn(),
    action: vi.fn(() => ({})),
    push: vi.fn(),
    deactivate: [] as (() => void)[],
    unmount: [] as (() => void)[],
  }),
)
vi.mock('../diagnostics/index.ts', async original => ({
  ...(await original<typeof import('../diagnostics/index.ts')>()),
  diagnostic,
  diagnosticAction: action,
}))
vi.mock('../api.ts', () => ({ api: { titles: { getTitleLibrary: library } } }))
vi.mock('../focus/index.ts', () => ({
  useFocus: () => ({ current: () => null }),
}))
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))
vi.mock('vue', async original => ({
  ...(await original<typeof import('vue')>()),
  onBeforeUnmount: (fn: () => void) => unmount.push(fn),
  onDeactivated: (fn: () => void) => deactivate.push(fn),
}))

const next = {
  season: 2,
  episode: 1,
  file: null,
  next: true,
  position: 0,
  duration: null,
}
const version = { id: 'local', season: 2, episode: 1, episodeTo: 3 }
const query = { title: 'show', season: '2', episode: '1' }

beforeEach(() => {
  vi.resetAllMocks()
  deactivate.length = 0
  unmount.length = 0
  action.mockReturnValue({})
})

describe('continue playback', () => {
  it('plays the exact library episode on click even with a known torrent or an older server', async () => {
    library.mockResolvedValue({ files: [{ ...version, season: 1 }, version] })
    await useContinuePlayback(shallowRef()).resume('show', {
      ...next,
      file: { torrentId: 'pack', fileIndex: 3 },
    })
    expect(library).toHaveBeenCalledWith(
      'show',
      { season: '2', episode: '1' },
      { signal: expect.any(AbortSignal) },
    )
    expect(push).toHaveBeenCalledExactlyOnceWith({
      path: '/play/library/local',
      query: { ...query, automatic: '1' },
    })
  })

  it('waits for a choice between versions of the target episode', async () => {
    library.mockResolvedValue({
      files: [version, { ...version, id: 'other' }],
    })
    const { picker, resume } = useContinuePlayback(shallowRef())
    await resume('show', {
      ...next,
      next: false,
      file: { torrentId: 'origin', fileIndex: 2 },
      mediaFileId: 'local',
    })
    expect(picker.selection.value?.currentId).toBe('local')
    expect(push).not.toHaveBeenCalled()
    picker.select('other')
    expect(push).toHaveBeenCalledExactlyOnceWith({
      path: '/play/library/other',
      query,
    })
  })

  it('opens the completed file from another torrent without searching', async () => {
    library.mockResolvedValue({
      files: [],
      downloadedFile: { torrentId: 'second', fileIndex: 3 },
    })
    await useContinuePlayback(shallowRef()).resume('show', next)
    expect(push).toHaveBeenCalledExactlyOnceWith({
      path: '/play/second/3',
      query: { ...query, automatic: '1' },
    })
  })

  it('keeps the existing fallback if the exact episode is absent', async () => {
    library.mockResolvedValue({ files: [{ ...version, season: 1 }] })
    await useContinuePlayback(shallowRef()).resume('show', next)
    expect(push).toHaveBeenCalledExactlyOnceWith({
      path: '/title/show/play',
      query: { season: '2', episode: '1', torrent: undefined, automatic: '1' },
    })
  })

  it.each([{ next: false }, { next: true, followNewEpisode: true }])(
    'opens the chosen torrent immediately and cancels a pending lookup %o',
    async (flags) => {
      library.mockResolvedValue({ files: [version] })
      const { resume } = useContinuePlayback(shallowRef())
      const pending = resume('other', next)
      await resume('show', {
        ...next,
        ...flags,
        file: { torrentId: 'original', fileIndex: 2 },
      })
      await pending
      expect(library).toHaveBeenCalledTimes(1)
      expect(push).toHaveBeenCalledExactlyOnceWith({
        path: '/play/original/2',
        query: { ...query, automatic: flags.next ? '1' : undefined },
      })
    },
  )

  it('does not fall back to a library origin when its version disappeared after the row loaded', async () => {
    library.mockResolvedValue({ files: [] })
    await useContinuePlayback(shallowRef()).resume('show', {
      ...next,
      next: false,
      file: { torrentId: 'origin', fileIndex: 2 },
      mediaFileId: 'missing',
    })
    expect(push).toHaveBeenCalledExactlyOnceWith({
      path: '/title/show/play',
      query: {
        season: '2',
        episode: '1',
        torrent: undefined,
        automatic: undefined,
      },
    })
  })

  it.each([
    ['click', [version]],
    ['longpress', [version, { ...version, id: 'other' }]],
  ] as const)(
    'ignores a late lookup after a new %s action on the screen',
    async (action, files) => {
      const screen = new EventTarget()
      const { resume, picker } = useContinuePlayback(shallowRef(screen))
      const reply = Promise.withResolvers<{ files: typeof files }>()
      library.mockReturnValue(reply.promise)
      let pending: Promise<void> | undefined
      screen.addEventListener(
        'click',
        () => {
          pending = resume('show', next)
        },
        { once: true },
      )
      screen.dispatchEvent(new Event('click', { bubbles: true }))
      const signal = library.mock.calls[0]![2].signal as AbortSignal

      screen.dispatchEvent(new Event('focusin'))
      expect(signal.aborted).toBe(false)
      screen.dispatchEvent(new Event(action, { bubbles: true }))
      expect(signal.aborted).toBe(true)
      reply.resolve({ files })
      await pending
      expect(push).not.toHaveBeenCalled()
      expect(picker.selection.value).toBeUndefined()
    },
  )

  it('ignores a late library response after leaving the screen', async () => {
    library.mockResolvedValue({ files: [version] })
    const pending = useContinuePlayback(shallowRef()).resume('show', next)
    deactivate.forEach(cancel => cancel())
    await pending
    expect(push).not.toHaveBeenCalled()
  })
})

it('routes an explicit ready action to the pick before library or known-file selection', async () => {
  await useContinuePlayback(shallowRef()).resume(
    'show',
    { ...next, file: { torrentId: 'old', fileIndex: 0 } },
    'follow-ready',
  )
  expect(library).not.toHaveBeenCalled()
  expect(push).toHaveBeenCalledExactlyOnceWith({
    path: '/title/show/play',
    query: {
      intent: 'follow-ready',
      automatic: '1',
      season: '2',
      episode: '1',
    },
  })
})
it('captures the selected snapshot before lookup resolves and keeps business routes equivalent', async () => {
  const item = { ...next, decisionId: 'decision-001' }
  const target = { ...version, id: 'file-00001' }
  library.mockResolvedValue({ files: [target] })
  await useContinuePlayback(shallowRef()).resume('tmdb:tv:100', item)
  const without = push.mock.calls[0]![0]
  push.mockClear()
  action.mockReturnValue({
    actionId: 'action-0001',
    clientSessionId: 'session-001',
  })
  let finish!: (value: unknown) => void
  library.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  const pending = useContinuePlayback(shallowRef()).resume(
    'tmdb:tv:100',
    item,
    undefined,
    'pointer',
  )
  expect(
    diagnostic.mock.calls.some(
      ([event]) =>
        event.event === 'continue.selected'
        && event.decisionId === 'decision-001',
    ),
  ).toBe(true)
  expect(push).not.toHaveBeenCalled()
  finish({ files: [target] })
  await pending
  const withDiagnostics = push.mock.calls[0]![0]
  expect(withDiagnostics.path).toBe(without.path)
  expect(withDiagnostics.query).toEqual(without.query)
  expect(withDiagnostics.state.diagnostic.actionId).toBe('action-0001')
})
it('distinguishes failed library lookup from an empty successful response', async () => {
  library.mockRejectedValueOnce(new Error('offline'))
  await useContinuePlayback(shallowRef()).resume('tmdb:tv:100', next)
  expect(
    diagnostic.mock.calls.some(
      ([event]) =>
        event.event === 'continue.route'
        && event.branch === 'library_lookup'
        && event.outcome === 'failed',
    ),
  ).toBe(true)
  diagnostic.mockClear()
  library.mockResolvedValueOnce({ files: [] })
  await useContinuePlayback(shallowRef()).resume('tmdb:tv:100', next)
  expect(
    diagnostic.mock.calls.some(
      ([event]) =>
        event.event === 'continue.route'
        && event.branch === 'library_lookup'
        && event.outcome === 'accepted',
    ),
  ).toBe(true)
})

it.each(['deactivated', 'unmounted'] as const)(
  'records the actual %s lookup cancellation once',
  async (reason) => {
    const reply = Promise.withResolvers<{ files: (typeof version)[] }>()
    library.mockReturnValue(reply.promise)
    const pending = useContinuePlayback(shallowRef()).resume('show', next);
    (reason === 'deactivated' ? deactivate : unmount).forEach(fn => fn())
    // A second lifecycle notification cannot overwrite the original cause.
    unmount.forEach(fn => fn())
    reply.resolve({ files: [version] })
    await pending
    expect(push).not.toHaveBeenCalled()
    expect(
      diagnostic.mock.calls
        .filter(([event]) => event.event === 'operation.cancelled')
        .map(([event]) => event.reason),
    ).toEqual([reason])
  },
)

it('keeps cancellation reasons with overlapping lookup operations', async () => {
  const a = Promise.withResolvers<{ files: (typeof version)[] }>()
  const b = Promise.withResolvers<{ files: (typeof version)[] }>()
  library.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise)
  const playback = useContinuePlayback(shallowRef())
  const first = playback.resume('first', next)
  const second = playback.resume('second', next)
  deactivate.forEach(fn => fn())
  b.resolve({ files: [version] })
  await second
  a.resolve({ files: [version] })
  await first
  expect(push).not.toHaveBeenCalled()
  expect(
    diagnostic.mock.calls
      .filter(([event]) => event.event === 'operation.cancelled')
      .map(([event]) => event.reason),
  ).toEqual(['deactivated', 'superseded'])
})

it.each(['back', 'generic', 'selection'] as const)(
  'keeps capture cancellation truthful for a bubbling %s click',
  async (kind) => {
    const screen = new EventTarget()
    const pendingReply = Promise.withResolvers<{ files: (typeof version)[] }>()
    library
      .mockReturnValueOnce(pendingReply.promise)
      .mockResolvedValue({ files: [] })
    const playback = useContinuePlayback(shallowRef(screen))
    const pending = playback.resume('first', next)
    const signal = library.mock.calls[0]![2].signal as AbortSignal
    let selected: Promise<void> | undefined
    // Equivalent to the TitlePage button's bubbling @click: the screen capture
    // listener runs first, then navigation deactivates, or a new selection starts.
    screen.addEventListener('click', () => {
      expect(signal.aborted).toBe(true)
      if (kind === 'selection')
        selected = playback.resume('second', next)
      else deactivate.forEach(fn => fn())
    })
    const click = new Event('click', { bubbles: true })
    const titleSource = readFileSync(
      new URL('../pages/TitlePage.vue', import.meta.url),
      'utf8',
    )
    const backButton = titleSource.match(
      /<button\b[^>]*@click="back"[^>]*>/,
    )?.[0]
    expect(backButton).toContain('data-diagnostic-action="back"')
    const closest = vi.fn((selector: string) =>
      kind === 'back'
      && selector === '[data-diagnostic-action="back"]'
      && backButton?.includes('data-diagnostic-action="back"')
        ? {}
        : null,
    )
    Object.defineProperty(click, 'target', { value: { closest } })
    screen.dispatchEvent(click)
    pendingReply.resolve({ files: [version] })
    await pending
    await selected
    expect(closest).toHaveBeenCalledWith('[data-diagnostic-action="back"]')
    const cancelled = diagnostic.mock.calls.filter(
      ([event]) => event.event === 'operation.cancelled',
    )
    expect(cancelled).toHaveLength(1)
    expect(cancelled[0]![0].reason).toBe(
      kind === 'back'
        ? 'back'
        : kind === 'selection'
          ? 'superseded'
          : 'user_interaction',
    )
    if (kind !== 'selection')
      expect(push).not.toHaveBeenCalled()
  },
)
