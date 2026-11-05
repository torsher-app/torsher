import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveEpisode } from './resolveEpisode.ts'
import { startDownload } from './useTitleDownload.ts'
import { selectSourcePreset } from '../sourcePreset.ts'

const requests = vi.hoisted(() => ({
  getTitleSources: vi.fn(),
  diagnostic: vi.fn(),
  getTitleFiles: vi.fn(),
  openFollowPick: vi.fn(),
  postTitleOpen: vi.fn(),
  postTitleDownload: vi.fn(),
}))
vi.mock('../api.ts', () => ({ api: { titles: requests } }))
vi.mock('@torsher/api-client', async original => ({
  ...(await original<typeof import('@torsher/api-client')>()),
  getErrorStatus: (error: { status?: number }) => error.status,
  getErrorBody: async (error: { body?: unknown }) => error.body,
}))
vi.mock('../diagnostics/index.ts', async (original) => {
  const actual = await original<typeof import('../diagnostics/index.ts')>()
  const { correlationHeaders } = await import('@torsher/api-client')
  return {
    ...actual,
    diagnostic: requests.diagnostic,
    diagnosticParams: (
      context?: import('@torsher/api-client').ApiRequestContext,
    ) => (context?.actionId ? { headers: correlationHeaders(context) } : {}),
  }
})
vi.mock('../session.ts', () => ({ session: { profile: { id: 'viewer' } } }))

beforeEach(() => {
  vi.resetAllMocks()
  selectSourcePreset('default-4k')
  requests.openFollowPick.mockRejectedValue(new Error('No pick'))
  requests.getTitleSources.mockResolvedValue({
    indexers: { total: 1 },
    candidates: [],
  })
  requests.getTitleFiles.mockResolvedValue({
    status: 'ready',
    files: [{ fileIndex: 0, season: 1, episode: 2, size: 100 }],
  })
  requests.postTitleOpen.mockResolvedValue({ torrentId: 'chosen' })
})

describe('source preset in playback and download', () => {
  it('passes the device/viewer selection to autoplay source search', async () => {
    await resolveEpisode(
      { titleId: 'title', season: 1, episode: 2 },
      { cancelled: () => false },
    )
    expect(requests.getTitleSources).toHaveBeenCalledWith(
      'title',
      {
        all: '1',
        presetId: 'default-4k',
      },
      {},
    )
  })

  it('keeps explicit candidates and known torrents ahead of preset search', async () => {
    await resolveEpisode(
      { titleId: 'title', season: 1, episode: 2 },
      { candidateId: 'explicit', cancelled: () => false },
    )
    expect(requests.postTitleOpen).toHaveBeenCalledWith(
      'title',
      {
        candidateId: 'explicit',
      },
      {},
    )
    expect(requests.getTitleSources).not.toHaveBeenCalled()
    await resolveEpisode(
      { titleId: 'title', season: 1, episode: 2 },
      { torrents: ['known'], cancelled: () => false },
    )
    expect(requests.getTitleFiles).toHaveBeenLastCalledWith(
      'title',
      'known',
      {},
    )
    expect(requests.getTitleSources).not.toHaveBeenCalled()
  })

  it('preserves FollowPick priority', async () => {
    requests.openFollowPick.mockResolvedValue({ torrentId: 'follow-pick' })
    await resolveEpisode(
      { titleId: 'title', season: 1, episode: 2 },
      { cancelled: () => false },
    )
    expect(requests.getTitleFiles).toHaveBeenCalledWith(
      'title',
      'follow-pick',
      {},
    )
    expect(requests.getTitleSources).not.toHaveBeenCalled()
  })

  it('keeps the selected preset and explicit candidate during download metadata retry', async () => {
    requests.postTitleDownload
      .mockResolvedValueOnce({
        status: 'resolving',
        torrentId: 'torrent',
        candidateId: 'candidate',
      })
      .mockResolvedValueOnce({ status: 'started' })
    await startDownload('title', { season: 1 }, () => false)
    expect(requests.postTitleDownload).toHaveBeenNthCalledWith(1, 'title', {
      season: 1,
      presetId: 'default-4k',
    })
    expect(requests.postTitleDownload).toHaveBeenNthCalledWith(2, 'title', {
      season: 1,
      presetId: 'default-4k',
      candidateId: 'candidate',
    })
  })
})

describe('explicit ready selection', () => {
  it('does not replace a rejected pick with a known torrent, candidate or search', async () => {
    requests.openFollowPick.mockRejectedValue({
      status: 409,
      body: { kind: 'follow_pick_unavailable' },
    })
    const result = await resolveEpisode(
      { titleId: 'title', season: 1, episode: 2 },
      {
        intent: 'follow-ready',
        torrents: ['known'],
        candidateId: 'explicit',
        cancelled: () => false,
      },
    )
    expect(result).toEqual({ kind: 'followUnavailable' })
    expect(requests.openFollowPick).toHaveBeenCalledWith(
      'title',
      {
        season: 1,
        episode: 2,
        intent: 'follow-ready',
      },
      {},
    )
    expect(requests.getTitleFiles).not.toHaveBeenCalled()
    expect(requests.getTitleSources).not.toHaveBeenCalled()
    expect(requests.postTitleOpen).not.toHaveBeenCalled()
  })
  it('opens only the ready pick when available', async () => {
    requests.openFollowPick.mockResolvedValue({ torrentId: 'ready' })
    expect(
      await resolveEpisode(
        { titleId: 'title', season: 1, episode: 2 },
        { intent: 'follow-ready', torrents: ['known'], cancelled: () => false },
      ),
    ).toEqual({ kind: 'found', file: { torrentId: 'ready', fileIndex: 0 } })
    expect(requests.getTitleFiles).toHaveBeenCalledWith('title', 'ready', {})
    expect(requests.getTitleSources).not.toHaveBeenCalled()
  })
})

describe('ready selection failures', () => {
  it.each([
    [new Error('offline'), 'followOpenFailed'],
    [{ status: 503 }, 'followOpenFailed'],
    [{ status: 422 }, 'followOpenFailed'],
    [{ status: 409, body: { kind: 'another_conflict' } }, 'followOpenFailed'],
    [{ status: 404 }, 'followUnsupported'],
  ])(
    'keeps errors retryable without a hidden fallback: %o',
    async (error, kind) => {
      requests.openFollowPick.mockRejectedValue(error)
      expect(
        await resolveEpisode(
          { titleId: 'title', season: 1, episode: 2 },
          { intent: 'follow-ready', torrents: ['old'], cancelled: () => false },
        ),
      ).toEqual({ kind })
      expect(requests.getTitleSources).not.toHaveBeenCalled()
      expect(requests.getTitleFiles).not.toHaveBeenCalled()
      expect(requests.postTitleOpen).not.toHaveBeenCalled()
    },
  )
  it('treats an opened pick without readable files as an opening failure', async () => {
    requests.openFollowPick.mockResolvedValue({ torrentId: 'ready' })
    requests.getTitleFiles.mockRejectedValue(new Error('offline'))
    expect(
      await resolveEpisode(
        { titleId: 'title', season: 1, episode: 2 },
        { intent: 'follow-ready', cancelled: () => false },
      ),
    ).toEqual({ kind: 'followOpenFailed' })
    expect(requests.getTitleSources).not.toHaveBeenCalled()
  })
  it('can retry the same ready intent after a temporary error', async () => {
    requests.openFollowPick
      .mockRejectedValueOnce({ status: 503 })
      .mockResolvedValueOnce({ torrentId: 'ready' })
    const target = { titleId: 'title', season: 1, episode: 2 }
    const options = { intent: 'follow-ready' as const, cancelled: () => false }
    expect((await resolveEpisode(target, options)).kind).toBe(
      'followOpenFailed',
    )
    expect((await resolveEpisode(target, options)).kind).toBe('found')
    expect(requests.openFollowPick).toHaveBeenCalledTimes(2)
    expect(requests.getTitleSources).not.toHaveBeenCalled()
  })
})

it('attempts a candidate ranked fourth after actual episode filtering, preserving its ranking snapshot', async () => {
  const candidates = [1, 2, 3, 4, 5].map(rank => ({
    id: String(rank).repeat(32),
    title: 'Synthetic item',
    confidence: 'high',
    seeders: 10,
    source: null,
    audioFit: null,
    seasons: rank < 4 ? [2] : [1],
    episodes: null,
    isPack: true,
    quality: '1080p',
    resolution: { value: '1080p', basis: 'title', sure: true },
    diagnostics: { rank, score: 10 - rank },
  }))
  requests.getTitleSources.mockResolvedValue({
    indexers: { total: 1 },
    candidates,
    rankingDecisionId: 'ranking-0001',
  })
  const outcome = await resolveEpisode(
    { titleId: 'tmdb:tv:100', season: 1, episode: 2 },
    { cancelled: () => false, diagnosticContext: { actionId: 'action-0001' } },
  )
  expect(outcome.kind).toBe('found')
  expect(requests.postTitleOpen).toHaveBeenCalledTimes(1)
  expect(requests.postTitleOpen.mock.calls[0]![1]).toEqual({
    candidateId: '4'.repeat(32),
  })
  expect(
    new Headers(requests.postTitleOpen.mock.calls[0]![2].headers).get(
      'x-torsher-ranking-decision-id',
    ),
  ).toBe('ranking-0001')
  const snapshot = requests.diagnostic.mock.calls.find(
    ([event]) =>
      event.event === 'source.resolve' && event.branch === 'ranked_candidate',
  )![0]
  expect(
    snapshot.candidates.map(
      (candidate: { diagnostics: { rank: number } }) =>
        candidate.diagnostics.rank,
    ),
  ).toEqual([4, 5])
  const attempts = requests.diagnostic.mock.calls.filter(
    ([event]) =>
      event.event === 'source.attempt' && event.branch === 'ranked_candidate',
  )
  expect(attempts).toHaveLength(1)
  expect(attempts[0]![0].candidateId).toBe('4'.repeat(32))
})
