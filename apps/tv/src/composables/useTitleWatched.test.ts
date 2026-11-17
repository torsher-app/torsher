import type { TitleMine } from '@torsher/api-client'
import { beforeEach, expect, it, vi } from 'vitest'
import { effectScope, nextTick } from 'vue'
import {
  captureTitleViewer,
  knownTitleMine,
  rememberTitleMine,
  setTitleViewer,
  titleActions,
  titleMineProgressVersion,
  titleMineRevision,
  titleProgressVersion,
} from '../titleActions.ts'
import { saveTitleWatched } from './useTitleWatched.ts'
import { mutateTitleMine } from './useTitleMineMutation.ts'
import { useTitleChanges } from './useTitleChanges.ts'

const mocks = vi.hoisted(() => ({ put: vi.fn(), get: vi.fn() }))
vi.mock('../api.ts', () => ({
  api: { titles: { putTitleWatched: mocks.put, getTitleMine: mocks.get } },
}))
beforeEach(() => {
  vi.resetAllMocks()
  setTitleViewer(undefined)
  setTitleViewer('A')
})

it('publishes one confirmed change even when mine readback fails after a successful PUT', async () => {
  mocks.put.mockResolvedValue(undefined)
  mocks.get.mockRejectedValue(new Error('offline'))
  const before = titleActions.version
  const progress = titleProgressVersion('title')
  await expect(
    saveTitleWatched('title', true, 'en-US', captureTitleViewer()),
  ).resolves.toBeUndefined()
  expect(titleActions.version).toBe(before + 1)
  expect(titleProgressVersion('title')).not.toBe(progress)
  expect(mocks.get).toHaveBeenCalledOnce()
})

it('does not publish a failed PUT or start its readback', async () => {
  mocks.put.mockRejectedValue(new Error('offline'))
  const before = titleActions.version
  await expect(
    saveTitleWatched('title', true, 'en-US', captureTitleViewer()),
  ).rejects.toThrow('offline')
  expect(titleActions.version).toBe(before)
  expect(mocks.get).not.toHaveBeenCalled()
})

it('reads the new mine state without a second invalidation', async () => {
  const mine = { status: 'watched', collections: [] } as unknown as TitleMine
  mocks.put.mockResolvedValue(undefined)
  mocks.get.mockResolvedValue(mine)
  const before = titleActions.version
  expect(
    await saveTitleWatched('title', true, 'en-US', captureTitleViewer()),
  ).toEqual(mine)
  expect(knownTitleMine('title')).toEqual(mine)
  expect(titleActions.version).toBe(before + 1)
})

it('rejects a late PUT from A after A/B/A and skips its readback', async () => {
  let finish!: () => void
  mocks.put.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  const pending = saveTitleWatched(
    'title',
    true,
    'en-US',
    captureTitleViewer(),
  )
  setTitleViewer('B')
  setTitleViewer('A')
  const before = titleActions.version
  finish()
  await pending
  expect(titleActions.version).toBe(before)
  expect(mocks.get).not.toHaveBeenCalled()
})

it('schedules mine reconciliation after a failed watched readback without repeating its successful PUT', async () => {
  const initial = {
    status: null,
    watchlist: true,
    collections: [],
  } as unknown as TitleMine
  const fresh = {
    ...initial,
    status: 'watched',
    watchlist: false,
  } as TitleMine
  const viewer = captureTitleViewer()
  rememberTitleMine('title', initial, viewer)
  mocks.put.mockResolvedValue(undefined)
  mocks.get
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(fresh)
  const scope = effectScope()
  const reconcile = vi.fn(async () => {
    const revision = titleMineRevision('title')
    rememberTitleMine('title', await mocks.get(), viewer, revision)
  })
  scope.run(() =>
    useTitleChanges(
      () => titleMineProgressVersion('title'),
      () => !titleActions.writing.has('title'),
      reconcile,
      () => true,
      () => false,
    ),
  )
  const version = titleActions.version
  await mutateTitleMine(
    'title',
    viewer,
    () => saveTitleWatched('title', true, 'en-US', viewer),
    undefined,
    false,
  )
  await nextTick()
  await nextTick()
  expect(reconcile).toHaveBeenCalledOnce()
  expect(knownTitleMine('title')).toEqual(fresh)
  expect(mocks.put).toHaveBeenCalledOnce()
  expect(mocks.get).toHaveBeenCalledTimes(2)
  expect(titleActions.version).toBe(version + 1)
  scope.stop()
})
