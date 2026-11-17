import { effectScope, nextTick, ref } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useHome } from './useHome.ts'

const mocks = vi.hoisted(() => ({ getHome: vi.fn() }))
vi.mock('../api.ts', () => ({
  api: { home: { getHome: mocks.getHome } },
  loadErrorOf: () => 'unavailable',
}))
vi.mock('./useCatalogLanguage.ts', () => ({
  useCatalogLanguage: () => ref('en-US'),
}))
vi.mock('../diagnostics/index.ts', () => ({}))
vi.mock('../diagnostics/continue.ts', () => ({
  noteContinueReceived: vi.fn(),
}))
vi.mock('../serverSources.ts', () => ({ noteHasSources: vi.fn() }))

let scope: ReturnType<typeof effectScope>
beforeEach(() => {
  vi.clearAllMocks()
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
