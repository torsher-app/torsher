import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveEpisode } from './resolveEpisode.ts'

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  files: vi.fn(),
  sources: vi.fn(),
}))
vi.mock('../api.ts', () => ({
  api: {
    titles: {
      postTitleOpen: mocks.open,
      getTitleFiles: mocks.files,
      getTitleSources: mocks.sources,
    },
  },
}))
vi.mock('../session.ts', () => ({ session: {} }))
vi.mock('../sourcePreset.ts', () => ({
  selectedSourcePreset: { value: undefined },
  sourcePresetStore: {},
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
