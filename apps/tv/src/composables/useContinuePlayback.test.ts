import { shallowRef } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useContinuePlayback } from './useContinuePlayback.ts'

const { library, push, deactivate } = vi.hoisted(() => ({
  library: vi.fn(),
  push: vi.fn(),
  deactivate: [] as (() => void)[],
}))
vi.mock('../api.ts', () => ({ api: { titles: { getTitleLibrary: library } } }))
vi.mock('../focus/index.ts', () => ({
  useFocus: () => ({ current: () => null }),
}))
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))
vi.mock('vue', async original => ({
  ...(await original<typeof import('vue')>()),
  onBeforeUnmount: vi.fn(),
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
      query,
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
      query,
    })
  })

  it('keeps the existing fallback if the exact episode is absent', async () => {
    library.mockResolvedValue({ files: [{ ...version, season: 1 }] })
    await useContinuePlayback(shallowRef()).resume('show', next)
    expect(push).toHaveBeenCalledExactlyOnceWith({
      path: '/title/show/play',
      query: { season: '2', episode: '1', torrent: undefined },
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
        query,
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
      query: { season: '2', episode: '1', torrent: undefined },
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
