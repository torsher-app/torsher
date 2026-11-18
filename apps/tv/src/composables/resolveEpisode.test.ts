import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApiClient } from '@torsher/api-client'
import { resolveEpisode } from './resolveEpisode.ts'

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  files: vi.fn(),
  sources: vi.fn(),
  follow: vi.fn(),
}))
vi.mock('../api.ts', () => ({
  api: {
    titles: {
      postTitleOpen: mocks.open,
      getTitleFiles: mocks.files,
      getTitleSources: mocks.sources,
      openFollowPick: mocks.follow,
    },
  },
}))
vi.mock('../session.ts', () => ({ session: {} }))
vi.mock('../sourcePreset.ts', () => ({
  selectedSourcePreset: { value: undefined },
  sourcePresetStore: { reconcile: vi.fn() },
}))
vi.mock('../serverSources.ts', () => ({ noteHasSources: vi.fn() }))

beforeEach(() => {
  vi.resetAllMocks()
  mocks.files.mockResolvedValue({
    status: 'ready',
    files: [
      { fileIndex: 0, season: 2, episode: 1, size: 1000 },
      { fileIndex: 5, season: 2, episode: 6, size: 1000 },
    ],
  })
})

describe('explicit episode source', () => {
  it('keeps the current pack when both it and history contain the watched episode', async () => {
    expect(
      await resolveEpisode(
        { titleId: 'show', season: 2, episode: 1 },
        { torrents: ['current', 'old'], cancelled: () => false },
      ),
    ).toEqual({ kind: 'found', file: { torrentId: 'current', fileIndex: 0 } })
    expect(mocks.files).toHaveBeenCalledTimes(1)
    expect(mocks.sources).not.toHaveBeenCalled()
  })

  it.each(['missing', 'unavailable'])(
    'falls back to history only after the current pack is %s',
    async (reason) => {
      mocks.files.mockImplementation(async (_title, torrent) => {
        if (torrent === 'current') {
          if (reason === 'unavailable')
            throw new Error('unavailable')
          return { status: 'ready', files: [] }
        }
        return {
          status: 'ready',
          files: [{ season: 2, episode: 1, fileIndex: 0, size: 1000 }],
        }
      })
      expect(
        await resolveEpisode(
          { titleId: 'show', season: 2, episode: 1 },
          { torrents: ['current', 'old'], cancelled: () => false },
        ),
      ).toEqual({ kind: 'found', file: { torrentId: 'old', fileIndex: 0 } })
      expect(mocks.files.mock.calls.map(call => call[1])).toEqual([
        'current',
        'old',
      ])
      expect(mocks.sources).not.toHaveBeenCalled()
    },
  )

  it('opens a candidate from a refined search with its query and keeps the exact episode', async () => {
    // The server can only recover this candidate from the matching search cache.
    mocks.open.mockImplementation(async (_title, body) => {
      if (body.query !== 'Alternate series title S02')
        throw new Error('candidate_gone')
      return { torrentId: 'refined-pack' }
    })
    const result = await resolveEpisode(
      { titleId: 'show', season: 2, episode: 6 },
      {
        candidateId: 'refined-candidate',
        query: 'Alternate series title S02',
        cancelled: () => false,
      },
    )
    expect(mocks.open).toHaveBeenCalledExactlyOnceWith(
      'show',
      {
        candidateId: 'refined-candidate',
        query: 'Alternate series title S02',
      },
      {},
    )
    expect(result).toEqual({
      kind: 'found',
      file: { torrentId: 'refined-pack', fileIndex: 5 },
    })
    expect(mocks.sources).not.toHaveBeenCalled()
  })

  it('keeps the default candidate path without a query and does not open after cancellation', async () => {
    mocks.open.mockResolvedValue({ torrentId: 'default-pack' })
    const target = { titleId: 'show', season: 2, episode: 6 }
    expect(
      await resolveEpisode(target, {
        candidateId: 'default',
        cancelled: () => false,
      }),
    ).toEqual({
      kind: 'found',
      file: { torrentId: 'default-pack', fileIndex: 5 },
    })
    expect(mocks.open).toHaveBeenCalledExactlyOnceWith(
      'show',
      {
        candidateId: 'default',
        query: undefined,
      },
      {},
    )
    expect(
      await resolveEpisode(target, {
        candidateId: 'refined',
        query: 'Alternate',
        cancelled: () => true,
      }),
    ).toEqual({ kind: 'cancelled' })
    expect(mocks.open).toHaveBeenCalledTimes(1)
  })
})

it('explains that an episode exists but is excluded from automatic selection', async () => {
  mocks.sources.mockResolvedValue({
    indexers: { total: 1 },
    candidates: [
      {
        id: 'foreign',
        seasons: [2],
        episodes: { from: 6, to: 6 },
        confidence: 'high',
        seeders: 2,
        source: 'WEB-DL',
        audioFit: 'foreign',
      },
    ],
  })
  const result = await resolveEpisode(
    { titleId: 'show', season: 2, episode: 6 },
    { cancelled: () => false },
  )
  expect(result).toEqual({
    kind: 'notFound',
    noSources: false,
    failureKind: 'unsuitable',
  })
  expect(mocks.open).not.toHaveBeenCalled()
})

it('does not report an absent episode when the search failed', async () => {
  mocks.sources.mockRejectedValue(new Error('offline'))
  expect(
    await resolveEpisode(
      { titleId: 'show', season: 2, episode: 6 },
      { cancelled: () => false },
    ),
  ).toEqual({
    kind: 'notFound',
    noSources: false,
    failureKind: 'searchFailed',
  })
})

it.each([new Error('offline'), { status: 503 }])(
  'keeps a file-list failure retryable without losing the selected source: %o',
  async (error) => {
    mocks.open.mockResolvedValue({ torrentId: 'selected-pack' })
    mocks.files.mockRejectedValueOnce(error)
    const target = { titleId: 'show', season: 2, episode: 6 }
    const options = {
      candidateId: 'selected',
      query: 'Alternate S02',
      cancelled: () => false,
    }
    expect(await resolveEpisode(target, options)).toEqual({
      kind: 'notFound',
      failureKind: 'filesFailed',
    })
    expect(await resolveEpisode(target, options)).toEqual({
      kind: 'found',
      file: { torrentId: 'selected-pack', fileIndex: 5 },
    })
    expect(mocks.open.mock.calls.map(call => call[1])).toEqual([
      { candidateId: 'selected', query: 'Alternate S02' },
      { candidateId: 'selected', query: 'Alternate S02' },
    ])
    expect(mocks.sources).not.toHaveBeenCalled()
  },
)
it('reserves absent-episode outcome for a successful ready list', async () => {
  mocks.open.mockResolvedValue({ torrentId: 'selected-pack' })
  mocks.files.mockResolvedValue({ status: 'ready', files: [] })
  expect(
    await resolveEpisode(
      { titleId: 'show', season: 2, episode: 6 },
      { candidateId: 'selected', cancelled: () => false },
    ),
  ).toEqual({ kind: 'notFound' })
})
it('does not turn a late file-list rejection after Back into a failure', async () => {
  let cancelled = false
  mocks.open.mockResolvedValue({ torrentId: 'selected-pack' })
  mocks.files.mockImplementation(async () => {
    cancelled = true
    throw new Error('offline')
  })
  expect(
    await resolveEpisode(
      { titleId: 'show' },
      { candidateId: 'selected', cancelled: () => cancelled },
    ),
  ).toEqual({ kind: 'cancelled' })
})
it('retains a known file-list failure when search finds no alternatives', async () => {
  mocks.files.mockRejectedValue(new Error('offline'))
  mocks.sources.mockResolvedValue({ indexers: { total: 0 }, candidates: [] })
  expect(
    await resolveEpisode(
      { titleId: 'show', season: 2, episode: 6 },
      { torrents: ['known'], cancelled: () => false },
    ),
  ).toEqual({ kind: 'notFound', noSources: true, failureKind: 'filesFailed' })
})
it('treats a deleted known torrent as absent after an otherwise successful empty search', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 404 })),
  )
  const client = createApiClient({
    getErrorMode: () => 'silent',
    onSessionExpired() {},
    onError() {},
    onFatal() {},
  })
  let error: unknown
  try {
    await client.titles.getTitleFiles('show', 'deleted')
  }
  catch (caught) {
    error = caught
  }
  finally {
    vi.unstubAllGlobals()
  }
  mocks.files.mockRejectedValue(error)
  mocks.sources.mockResolvedValue({ indexers: { total: 0 }, candidates: [] })
  expect(
    await resolveEpisode(
      { titleId: 'show', season: 2, episode: 6 },
      { torrents: ['deleted'], cancelled: () => false },
    ),
  ).toEqual({ kind: 'notFound', noSources: true })
})
it('continues ranked candidates after a file-list failure', async () => {
  mocks.sources.mockResolvedValue({
    indexers: { total: 1 },
    candidates: ['first', 'second'].map(id => ({
      id,
      seasons: [2],
      episodes: { from: 6, to: 6 },
      confidence: 'high',
      seeders: 2,
    })),
  })
  mocks.open.mockImplementation(async (_title, body) => ({
    torrentId: body.candidateId,
  }))
  mocks.files.mockRejectedValueOnce(new Error('offline'))
  expect(
    await resolveEpisode(
      { titleId: 'show', season: 2, episode: 6 },
      { cancelled: () => false },
    ),
  ).toEqual({ kind: 'found', file: { torrentId: 'second', fileIndex: 5 } })
})
it('retains ranked file-list failures instead of declaring the episode absent', async () => {
  mocks.sources.mockResolvedValue({
    indexers: { total: 1 },
    candidates: [
      {
        id: 'first',
        seasons: [2],
        episodes: { from: 6, to: 6 },
        confidence: 'high',
        seeders: 2,
      },
    ],
  })
  mocks.open.mockResolvedValue({ torrentId: 'first' })
  mocks.files.mockRejectedValue(new Error('offline'))
  expect(
    await resolveEpisode(
      { titleId: 'show', season: 2, episode: 6 },
      { cancelled: () => false },
    ),
  ).toEqual({ kind: 'notFound', noSources: false, failureKind: 'filesFailed' })
})

it('keeps a metadata timeout distinct from a failed HTTP file-list request', async () => {
  vi.useFakeTimers()
  try {
    mocks.open.mockResolvedValue({ torrentId: 'pending-pack' })
    mocks.files.mockResolvedValue({
      status: 'resolving',
      name: 'Pending',
      files: [],
    })
    const result = resolveEpisode(
      { titleId: 'show' },
      { candidateId: 'pending', cancelled: () => false },
    )
    await vi.advanceTimersByTimeAsync(90_000)
    expect(await result).toEqual({ kind: 'notFound' })
  }
  finally {
    vi.useRealTimers()
  }
})

it('keeps follow-ready file-list failures in its existing retryable outcome', async () => {
  mocks.follow.mockResolvedValue({ torrentId: 'follow-pack' })
  mocks.files.mockRejectedValueOnce(new Error('offline'))
  const target = { titleId: 'show', season: 2, episode: 6 }
  expect(
    await resolveEpisode(target, {
      intent: 'follow-ready',
      cancelled: () => false,
    }),
  ).toEqual({ kind: 'followOpenFailed' })
  expect(
    await resolveEpisode(target, {
      intent: 'follow-ready',
      cancelled: () => false,
    }),
  ).toEqual({
    kind: 'found',
    file: { torrentId: 'follow-pack', fileIndex: 5 },
  })
})
