import { effectScope, nextTick, ref } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ContinueRow } from '@torsher/api-client'
import { setTitleViewer } from '../titleActions.ts'
import { useHome } from './useHome.ts'

const mocks = vi.hoisted(() => ({ getHome: vi.fn(), getContinue: vi.fn() }))
vi.mock('../api.ts', () => ({
  api: { home: { getHome: mocks.getHome, getHomeContinue: mocks.getContinue } },
  loadErrorOf: () => 'unavailable',
}))
vi.mock('./useCatalogLanguage.ts', () => ({
  useCatalogLanguage: () => ref('en-US'),
}))
vi.mock('../diagnostics/index.ts', () => ({
  diagnostic: vi.fn(),
  diagnosticAction: () => ({}),
  diagnosticParams: () => ({}),
}))
vi.mock('../diagnostics/continue.ts', () => ({
  noteContinueReceived: vi.fn(),
}))
vi.mock('../serverSources.ts', () => ({ noteHasSources: vi.fn() }))

let scope: ReturnType<typeof effectScope>
beforeEach(() => {
  vi.resetAllMocks()
  setTitleViewer(undefined)
  setTitleViewer('A')
  scope = effectScope()
})
afterEach(() => scope.stop())

it('keeps personal rows ready with a catalog notice and clears it for older or recovered servers', async () => {
  const rows = [
    {
      id: 'watchlist',
      kind: 'posters',
      title: 'home.rows.watchlist',
      items: [],
    },
  ]
  mocks.getHome.mockResolvedValue({
    rows,
    hasSources: false,
    catalogError: 'notConfigured',
  })
  const home = scope.run(() => useHome(ref('all')))!
  await vi.waitFor(() => expect(home.status.value).toBe('ready'))
  expect(home.rows.value).toEqual(rows)
  expect(home.catalogError.value).toBe('notConfigured')

  // Older servers have no optional field; a later successful refresh must not
  // leave the previous server's notice visible.
  mocks.getHome.mockResolvedValue({ rows, hasSources: false })
  await home.refresh()
  expect(home.status.value).toBe('ready')
  expect(home.catalogError.value).toBeUndefined()
})

it('ignores an older mode response including its catalog notice', async () => {
  const replies: ((value: object) => void)[] = []
  mocks.getHome.mockImplementation(
    () => new Promise(resolve => replies.push(resolve)),
  )
  const mode = ref<'all' | 'movies'>('all')
  const home = scope.run(() => useHome(mode))!
  mode.value = 'movies'
  await nextTick()
  replies[1]!({ rows: [], hasSources: false })
  await vi.waitFor(() => expect(home.status.value).toBe('ready'))
  replies[0]!({ rows: [], hasSources: false, catalogError: 'notConfigured' })
  await nextTick()
  expect(home.catalogError.value).toBeUndefined()
})

function continueRow(id: string) {
  return {
    id: 'continue',
    kind: 'continue',
    title: 'home.rows.continue',
    items: [{ id, kind: 'movie', title: id, originalTitle: id }],
  } as ContinueRow
}

it('cancels a partial Continue request at full refresh start and rejects its late result', async () => {
  let finishPartial!: (value: ContinueRow) => void
  let finishFull!: (value: object) => void
  mocks.getHome.mockResolvedValueOnce({
    rows: [continueRow('initial')],
    hasSources: false,
  })
  const home = scope.run(() => useHome(ref('all')))!
  await vi.waitFor(() => expect(home.status.value).toBe('ready'))
  mocks.getContinue.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishPartial = resolve
      }),
  )
  const partial = home.refreshContinue()
  mocks.getHome.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishFull = resolve
      }),
  )
  const full = home.refresh()
  expect(mocks.getContinue.mock.calls[0]![1].signal.aborted).toBe(true)
  await home.refreshContinue()
  expect(mocks.getContinue).toHaveBeenCalledOnce()
  finishFull({ rows: [continueRow('fresh')], hasSources: false })
  await full
  finishPartial(continueRow('stale'))
  await partial
  expect(home.rows.value).toEqual([continueRow('fresh')])
})

it('ignores a deferred Continue result after mode or viewer changes', async () => {
  let finish!: (value: ContinueRow) => void
  mocks.getHome.mockResolvedValue({
    rows: [continueRow('initial')],
    hasSources: false,
  })
  const mode = ref<'all' | 'movies'>('all')
  const home = scope.run(() => useHome(mode))!
  await vi.waitFor(() => expect(home.status.value).toBe('ready'))
  mocks.getContinue.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const partial = home.refreshContinue()
  mode.value = 'movies'
  await nextTick()
  finish(continueRow('stale-mode'))
  await partial
  await vi.waitFor(() => expect(home.refreshing.value).toBe(false))
  const viewerPartial = home.refreshContinue()
  setTitleViewer('B')
  setTitleViewer('A')
  finish(continueRow('stale-viewer'))
  await viewerPartial
  expect(home.rows.value).toEqual([continueRow('initial')])
})

it('rejects a deferred full response after disposal', async () => {
  let finish!: (value: object) => void
  mocks.getHome.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const home = scope.run(() => useHome(ref('all')))!
  scope.stop()
  finish({ rows: [continueRow('stale')], hasSources: false })
  await nextTick()
  await nextTick()
  expect(home.rows.value).toEqual([])
})
