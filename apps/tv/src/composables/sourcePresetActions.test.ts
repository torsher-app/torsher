import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveEpisode } from './resolveEpisode.ts'
import { startDownload } from './useTitleDownload.ts'
import { selectSourcePreset } from '../sourcePreset.ts'

const requests = vi.hoisted(() => ({
  getTitleSources: vi.fn(),
  getTitleFiles: vi.fn(),
  openFollowPick: vi.fn(),
  postTitleOpen: vi.fn(),
  postTitleDownload: vi.fn(),
}))
vi.mock('../api.ts', () => ({ api: { titles: requests } }))
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
    expect(requests.getTitleSources).toHaveBeenCalledWith('title', {
      all: '1',
      presetId: 'default-4k',
    })
  })

  it('keeps explicit candidates and known torrents ahead of preset search', async () => {
    await resolveEpisode(
      { titleId: 'title', season: 1, episode: 2 },
      { candidateId: 'explicit', cancelled: () => false },
    )
    expect(requests.postTitleOpen).toHaveBeenCalledWith('title', {
      candidateId: 'explicit',
    })
    expect(requests.getTitleSources).not.toHaveBeenCalled()
    await resolveEpisode(
      { titleId: 'title', season: 1, episode: 2 },
      { torrents: ['known'], cancelled: () => false },
    )
    expect(requests.getTitleFiles).toHaveBeenLastCalledWith('title', 'known')
    expect(requests.getTitleSources).not.toHaveBeenCalled()
  })

  it('preserves FollowPick priority', async () => {
    requests.openFollowPick.mockResolvedValue({ torrentId: 'follow-pick' })
    await resolveEpisode(
      { titleId: 'title', season: 1, episode: 2 },
      { cancelled: () => false },
    )
    expect(requests.getTitleFiles).toHaveBeenCalledWith('title', 'follow-pick')
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
