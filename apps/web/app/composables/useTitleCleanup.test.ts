import type { TitleCleanupPreview } from '@torsher/api-client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useTitleCleanup } from './useTitleCleanup'

const mocks = vi.hoisted(() => ({
  getTitleCleanupTitles: vi.fn(),
  postTitleCleanupPreview: vi.fn(),
  postTitleCleanupExecute: vi.fn(),
  getLibraryMaintenanceStatus: vi.fn(),
}))

vi.mock('~/services/api', () => ({
  api: { torrents: mocks, libraryMaintenance: mocks },
}))

const movie = 'tmdb:movie:1'
const show = 'tmdb:tv:2'

function candidate(id: string): TitleCleanupPreview['items'][number] {
  return {
    id,
    name: id,
    files: [],
    downloads: [],
    fingerprint: 'a'.repeat(64),
    reason: null,
  }
}

beforeEach(() => {
  vi.stubGlobal('withErrorMode', (_mode: string, call: () => unknown) =>
    call())
  mocks.getTitleCleanupTitles.mockResolvedValue({
    items: [movie, show].map(id => ({
      id,
      name: id,
      libraryBytes: 8,
      downloadBytes: 8,
    })),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetAllMocks()
})

it('does not silently delete a subset when a selected title is blocked', async () => {
  const screen = useTitleCleanup()
  expect(screen.selected.value.size).toBe(0)
  await screen.load()
  screen.toggle(movie, true)
  screen.toggle(show, true)
  mocks.postTitleCleanupPreview.mockResolvedValue({
    items: [
      candidate(movie),
      { ...candidate(show), fingerprint: null, reason: 'private' },
    ],
    reclaimableBytes: null,
  })

  await screen.openPreview()
  await screen.execute()

  expect(screen.confirmation.value).toEqual([])
  expect(mocks.postTitleCleanupExecute).not.toHaveBeenCalled()

  mocks.postTitleCleanupPreview.mockResolvedValue({
    items: [candidate(movie)],
    reclaimableBytes: 8,
  })
  mocks.postTitleCleanupExecute.mockResolvedValue({
    items: [{ id: movie, status: 'deleted', operationIds: [] }],
  })
  await screen.excludeFromPreview(show)
  expect(mocks.postTitleCleanupPreview).toHaveBeenLastCalledWith({
    titleIds: [movie],
  })
  await screen.execute()
  expect(mocks.postTitleCleanupExecute).toHaveBeenCalledTimes(1)
  expect(mocks.postTitleCleanupExecute).toHaveBeenCalledWith({
    items: [{ id: movie, fingerprint: 'a'.repeat(64) }],
  })
})

it('keeps per-title results and finds the pending manual operation after a timeout', async () => {
  const screen = useTitleCleanup()
  await screen.load()
  screen.toggle(movie, true)
  screen.toggle(show, true)
  mocks.postTitleCleanupPreview.mockResolvedValue({
    items: [candidate(movie), candidate(show)],
    reclaimableBytes: 16,
  })
  mocks.postTitleCleanupExecute
    .mockResolvedValueOnce({
      items: [{ id: movie, status: 'deleted', operationIds: [] }],
    })
    .mockRejectedValueOnce(new Error('timeout'))
  mocks.getLibraryMaintenanceStatus.mockResolvedValue({
    operations: [
      {
        titleId: show,
        groupId: 'manual-torrent:test',
        id: 'manual',
        action: 'retry',
      },
      {
        titleId: show,
        groupId: 'manual-library:test',
        id: 'detached',
        action: 'retry',
      },
      { titleId: show, groupId: 'automatic', id: 'automatic', action: 'retry' },
    ],
  })

  await screen.openPreview()
  await screen.execute()

  expect(mocks.postTitleCleanupExecute).toHaveBeenNthCalledWith(1, {
    items: [{ id: movie, fingerprint: 'a'.repeat(64) }],
  })
  expect(mocks.postTitleCleanupExecute).toHaveBeenNthCalledWith(2, {
    items: [{ id: show, fingerprint: 'a'.repeat(64) }],
  })
  expect(screen.result.value?.items).toEqual([
    { id: movie, status: 'deleted', operationIds: [] },
    { id: show, status: 'partial', operationIds: ['manual', 'detached'] },
  ])
  expect([...screen.selected.value]).toEqual([show])
})
