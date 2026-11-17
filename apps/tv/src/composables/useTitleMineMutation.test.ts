import type { TitleMine } from '@torsher/api-client'
import { beforeEach, expect, it, vi } from 'vitest'
import {
  captureTitleViewer,
  closeTitleActions,
  isTitleActionCurrent,
  knownTitleMine,
  openTitleActions,
  rememberTitleMine,
  setTitleViewer,
  titleActions,
  titleMineRevision,
} from '../titleActions.ts'
import { mutateTitleMine, patchTitleMine } from './useTitleMineMutation.ts'

const mocks = vi.hoisted(() => ({ patch: vi.fn() }))
vi.mock('../api.ts', () => ({
  api: { titles: { patchTitleMine: mocks.patch } },
}))

const initial = {
  rating: null,
  watchlist: false,
  collections: [],
} as unknown as TitleMine
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}
function viewer() {
  return captureTitleViewer()
}
beforeEach(() => {
  vi.resetAllMocks()
  setTitleViewer(undefined)
  setTitleViewer('A')
  rememberTitleMine('title', initial, viewer())
})

it('saves the exact cold rating before a delayed initial GET and keeps its confirmed snapshot', async () => {
  const initialRead = deferred<TitleMine>()
  const write = deferred<TitleMine>()
  const scope = viewer()
  const revision = titleMineRevision('cold')
  const reading = initialRead.promise.then(value =>
    rememberTitleMine('cold', value, scope, revision),
  )
  mocks.patch.mockReturnValueOnce(write.promise)
  openTitleActions({ id: 'cold', title: 'Cold', kind: 'movie' }, 'rating')
  const saving = patchTitleMine('cold', scope, { rating: 8 }, 'en-US')
  closeTitleActions()
  expect(mocks.patch).toHaveBeenCalledExactlyOnceWith(
    'cold',
    { rating: 8 },
    { language: 'en-US' },
  )
  write.resolve({ ...initial, rating: 8 })
  await saving
  initialRead.resolve(initial)
  await reading
  expect(knownTitleMine('cold')?.rating).toBe(8)
})

it('waits for known mine before inversions while allowing a cold absolute clear rating', async () => {
  mocks.patch.mockResolvedValueOnce(initial)
  await patchTitleMine('cold', viewer(), { watchlist: true }, 'en-US')
  await patchTitleMine('cold', viewer(), { favorite: true }, 'en-US')
  await patchTitleMine('cold', viewer(), { dropped: true }, 'en-US')
  expect(mocks.patch).not.toHaveBeenCalled()
  await patchTitleMine('cold', viewer(), { rating: null }, 'en-US')
  expect(mocks.patch).toHaveBeenCalledExactlyOnceWith(
    'cold',
    { rating: null },
    { language: 'en-US' },
  )
})

it('serializes quick reopened ratings and never paints the older successful snapshot over the newer intent', async () => {
  const first = deferred<TitleMine>()
  const second = deferred<TitleMine>()
  const write = vi
    .fn()
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise)
  const version = titleActions.version
  openTitleActions({ id: 'title', title: 'Title', kind: 'movie' }, 'rating')
  const one = mutateTitleMine(
    'title',
    viewer(),
    () => write(3),
    value => ({ ...value, rating: 3 }),
  )
  closeTitleActions()
  openTitleActions({ id: 'title', title: 'Title', kind: 'movie' }, 'rating')
  const two = mutateTitleMine(
    'title',
    viewer(),
    () => write(8),
    value => ({ ...value, rating: 8 }),
  )
  closeTitleActions()
  expect(write).toHaveBeenCalledExactlyOnceWith(3)
  expect(knownTitleMine('title')?.rating).toBe(8)
  first.resolve({ ...initial, rating: 3 })
  await one
  expect(write.mock.calls).toEqual([[3], [8]])
  expect(knownTitleMine('title')?.rating).toBe(8)
  second.resolve({ ...initial, rating: 8 })
  await two
  expect(knownTitleMine('title')?.rating).toBe(8)
  expect(titleActions.version).toBe(version + 2)
  expect(titleActions.writing.has('title')).toBe(false)
})

it('rebases a queued rating over the last confirmed state when an earlier watchlist write fails', async () => {
  const first = deferred<TitleMine>()
  const second = deferred<TitleMine>()
  const one = mutateTitleMine(
    'title',
    viewer(),
    () => first.promise,
    value => ({ ...value, watchlist: true }),
  )
  const rejected = expect(one).rejects.toThrow('offline')
  const writeRating = vi.fn(() => second.promise)
  const two = mutateTitleMine('title', viewer(), writeRating, value => ({
    ...value,
    rating: 9,
  }))
  first.reject(new Error('offline'))
  await rejected
  expect(writeRating).toHaveBeenCalledExactlyOnceWith(initial)
  expect(knownTitleMine('title')).toMatchObject({
    watchlist: false,
    rating: 9,
  })
  second.resolve({ ...initial, rating: 9 })
  await two
  expect(knownTitleMine('title')).toMatchObject({
    watchlist: false,
    rating: 9,
  })
})

it('rolls a failed later rating back to the previous confirmed rating after normal panel close', async () => {
  const first = deferred<TitleMine>()
  const second = deferred<TitleMine>()
  const one = mutateTitleMine(
    'title',
    viewer(),
    () => first.promise,
    value => ({ ...value, rating: 3 }),
  )
  openTitleActions({ id: 'title', title: 'Title', kind: 'movie' }, 'rating')
  const revision = titleActions.menuRevision
  const two = mutateTitleMine(
    'title',
    viewer(),
    () => second.promise,
    value => ({ ...value, rating: 8 }),
  )
  const rejected = expect(two).rejects.toThrow('offline')
  closeTitleActions()
  first.resolve({ ...initial, rating: 3 })
  await one
  second.reject(new Error('offline'))
  await rejected
  expect(knownTitleMine('title')?.rating).toBe(3)
  expect(isTitleActionCurrent(viewer(), revision)).toBe(true)
  openTitleActions({ id: 'title', title: 'Title', kind: 'movie' }, 'rating')
  expect(isTitleActionCurrent(viewer(), revision)).toBe(false)
})

it('keeps double watchlist inversions in server order', async () => {
  const first = deferred<TitleMine>()
  const second = deferred<TitleMine>()
  const write = vi
    .fn()
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise)
  const one = mutateTitleMine(
    'title',
    viewer(),
    () => write(true),
    value => ({ ...value, watchlist: true }),
  )
  const next = !knownTitleMine('title')!.watchlist
  const two = mutateTitleMine(
    'title',
    viewer(),
    () => write(next),
    value => ({ ...value, watchlist: next }),
  )
  expect(next).toBe(false)
  expect(write).toHaveBeenCalledExactlyOnceWith(true)
  first.resolve({ ...initial, watchlist: true })
  await one
  expect(write.mock.calls).toEqual([[true], [false]])
  second.resolve(initial)
  await two
  expect(knownTitleMine('title')?.watchlist).toBe(false)
})

it('rejects reads during pending writes, including reads begun after the optimistic state', async () => {
  const first = deferred<TitleMine>()
  const one = mutateTitleMine(
    'title',
    viewer(),
    () => first.promise,
    value => ({ ...value, rating: 7 }),
  )
  const readRevision = titleMineRevision('title')
  rememberTitleMine('title', initial, viewer(), readRevision)
  expect(knownTitleMine('title')?.rating).toBe(7)
  first.resolve({ ...initial, rating: 7 })
  await one
  rememberTitleMine('title', initial, viewer(), readRevision)
  expect(knownTitleMine('title')?.rating).toBe(7)
})

it('does not send queued writes through the next viewer cookie after A/B/A', async () => {
  const first = deferred<TitleMine>()
  const one = mutateTitleMine(
    'title',
    viewer(),
    () => first.promise,
    value => ({ ...value, rating: 3 }),
  )
  const queuedHttp = vi.fn(() => Promise.resolve({ ...initial, rating: 8 }))
  const two = mutateTitleMine('title', viewer(), queuedHttp, value => ({
    ...value,
    rating: 8,
  }))
  setTitleViewer('B')
  setTitleViewer('A')
  const version = titleActions.version
  first.resolve({ ...initial, rating: 3 })
  await Promise.all([one, two])
  expect(queuedHttp).not.toHaveBeenCalled()
  expect(knownTitleMine('title')).toBeUndefined()
  expect(titleActions.version).toBe(version)
})
