import type { Episode, TitleProgress } from '@torsher/api-client'
import { nextTick, ref, shallowRef } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useEpisodeActions } from './useEpisodeActions.ts'

const mocks = vi.hoisted(() => ({
  library: vi.fn(),
  mark: vi.fn(),
  refresh: vi.fn(),
  push: vi.fn(),
  focusOn: vi.fn(),
  opener: { isConnected: true },
  deactivate: [] as (() => void)[],
}))
vi.mock('../api.ts', () => ({
  api: {
    titles: { getTitleLibrary: mocks.library, putTitleWatched: mocks.mark },
  },
}))
vi.mock('../focus/index.ts', () => ({
  useFocus: () => ({ current: () => mocks.opener, focusOn: mocks.focusOn }),
}))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: mocks.push }) }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('vue', async original => ({
  ...(await original<typeof import('vue')>()),
  onBeforeUnmount: vi.fn(),
  onDeactivated: (fn: () => void) => mocks.deactivate.push(fn),
}))
const episode = {
  number: 6,
  title: 'Episode six',
  airDate: '2020-01-01',
} as Episode
const point = {
  season: 2,
  episode: 6,
  position: 300,
  duration: 1800,
  watched: false,
}
const version = { id: 'local', season: 2, episode: 5, episodeTo: 7 }
function setup(ready = true) {
  const season = ref(2)
  const progress = shallowRef<TitleProgress>({
    resume: null,
    last: null,
    seasonReleases: [],
    episodes: [{ ...point }],
  })
  const actions = useEpisodeActions(
    ref('show'),
    season,
    progress,
    () => ready,
    mocks.refresh,
  )
  actions.open(episode)
  return { ...actions, season, progress }
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.deactivate.length = 0
  mocks.library.mockResolvedValue({ files: [] })
  mocks.mark.mockResolvedValue({})
})

describe('episode actions', () => {
  it('plays an exact episode inside a library range, independently of title resume', async () => {
    mocks.library.mockResolvedValue({
      files: [{ ...version, season: 1 }, version],
    })
    const actions = setup()
    await actions.select('play')
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith({
      path: '/play/library/local',
      query: { title: 'show', season: '2', episode: '6' },
    })
  })
  it('keeps start intent through explicit version selection; cancel restores actions without playback', async () => {
    mocks.library.mockResolvedValue({
      files: [version, { ...version, id: 'other' }],
    })
    const actions = setup()
    await actions.select('start')
    expect(actions.picker.selection.value?.target).toEqual({
      season: 2,
      episode: 6,
    })
    actions.picker.close()
    expect(actions.context.value?.episode).toEqual(episode)
    expect(actions.focusOption.value).toBe('start')
    expect(mocks.push).not.toHaveBeenCalled()
    await actions.select('start')
    actions.picker.select('other')
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith({
      path: '/play/library/other',
      query: { title: 'show', season: '2', episode: '6', start: '0' },
    })
  })
  it('preserves the exact goal and zero intent in downloaded-file and source-selection routes', async () => {
    const actions = setup()
    mocks.library.mockResolvedValueOnce({
      files: [],
      downloadedFile: { torrentId: 'pack', fileIndex: 8 },
    })
    await actions.select('start')
    expect(mocks.push.mock.calls[0]![0]).toMatchObject({
      path: '/play/pack/8',
      query: { season: '2', episode: '6', start: '0' },
    })
    await actions.select('start')
    expect(mocks.push.mock.calls[1]![0]).toMatchObject({
      path: '/title/show/sources',
      query: { season: '2', episode: '6', start: '0' },
    })
  })
  it.each([false, true])(
    'asks for a source without playback history, including manual watched=%s',
    async (watched) => {
      const actions = setup()
      actions.progress.value = {
        ...actions.progress.value,
        episodes: watched ? [{ ...point, position: 0, watched: true }] : [],
      }
      await actions.select('play')
      expect(mocks.push).toHaveBeenCalledExactlyOnceWith({
        path: '/title/show/sources',
        query: { season: '2', episode: '6' },
      })
    },
  )
  it('reuses the previous season source only when it contains the selected episode', async () => {
    const actions = setup()
    actions.progress.value = {
      ...actions.progress.value,
      seasonReleases: [
        {
          season: 2,
          torrentId: 'previous',
          episodes: [6],
          quality: null,
          voice: null,
        },
      ],
    }
    await actions.select('play')
    expect(mocks.push.mock.calls[0]![0]).toMatchObject({
      path: '/title/show/play',
      query: { season: '2', episode: '6', torrent: 'previous' },
    })
    actions.open({ ...episode, number: 7 })
    await actions.select('play')
    expect(mocks.push.mock.calls[1]![0]).toEqual({
      path: '/title/show/sources',
      query: { season: '2', episode: '7' },
    })
  })
  it.each(['close', 'deactivate'] as const)(
    'cancels a pending lookup on %s',
    async (cancel) => {
      let resolve!: (value: unknown) => void
      mocks.library.mockImplementation(
        () =>
          new Promise((done) => {
            resolve = done
          }),
      )
      const actions = setup()
      const pending = actions.select('play')
      if (cancel === 'close')
        actions.close()
      else mocks.deactivate.forEach(fn => fn())
      resolve({ files: [version] })
      await pending
      expect(mocks.push).not.toHaveBeenCalled()
    },
  )
  it('mark and unmark reset position and duration according to the server contract', async () => {
    const actions = setup()
    await actions.select('mark')
    expect(actions.progress.value.episodes[0]).toEqual({
      ...point,
      position: 0,
      watched: true,
    })
    expect(mocks.refresh).toHaveBeenCalledOnce()
    expect(actions.context.value).toBeUndefined()
    actions.open(episode)
    expect(actions.options.value.map(option => option.id)).toEqual([
      'play',
      'mark',
    ])
    await actions.select('mark')
    expect(actions.progress.value.episodes[0]).toEqual({
      ...point,
      position: 0,
      duration: null,
    })
    await nextTick()
    expect(mocks.refresh).toHaveBeenCalledTimes(2)
    expect(mocks.focusOn).toHaveBeenCalledWith(mocks.opener)
  })
  it('a failed mark preserves every field and leaves the panel available for retry', async () => {
    mocks.mark.mockRejectedValueOnce(new Error('offline'))
    const actions = setup()
    await actions.select('mark')
    expect(actions.progress.value.episodes[0]).toEqual(point)
    expect(actions.context.value).toBeDefined()
    expect(actions.error.value).toBe('actions.errors.save')
    await actions.select('mark')
    expect(actions.context.value).toBeUndefined()
  })
  it('hold saves once and a late reply updates its original season only', async () => {
    let resolve!: () => void
    mocks.mark.mockImplementation(
      () =>
        new Promise<void>((done) => {
          resolve = done
        }),
    )
    const actions = setup()
    actions.close()
    actions.hold(episode)
    actions.hold(episode)
    actions.season.value = 3
    resolve()
    await vi.waitFor(() =>
      expect(actions.progress.value.episodes[0]?.watched).toBe(true),
    )
    expect(mocks.mark).toHaveBeenCalledTimes(1)
    expect(actions.progress.value.episodes[0]?.season).toBe(2)
    expect(actions.context.value).toBeUndefined()
    expect(mocks.push).not.toHaveBeenCalled()
  })
  it('does not act before progress settles or on an upcoming episode', async () => {
    const pending = setup(false)
    await pending.select('play')
    pending.hold(episode)
    expect(pending.options.value.every(option => option.disabled)).toBe(true)
    const actions = setup()
    actions.close()
    const upcoming = { ...episode, airDate: '2999-01-01' }
    actions.open(upcoming)
    actions.hold(upcoming)
    expect(actions.context.value).toBeUndefined()
    expect(mocks.library).not.toHaveBeenCalled()
    expect(mocks.mark).not.toHaveBeenCalled()
  })
})
