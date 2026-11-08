import type { Backdrop, Profile } from '@torsher/api-client'
import { effectScope, reactive } from 'vue'
import { beforeEach, expect, it, vi } from 'vitest'
import { useScreensaverBackdrops } from './useScreensaverBackdrops.ts'
import { session } from '../session.ts'

const mocks = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('../api.ts', () => ({
  api: { catalog: { getCatalogBackdrops: mocks.get } },
}))
vi.mock('../session.ts', () => ({
  session: reactive({
    status: 'ready',
    profile: { id: 'adult', ageLimit: null },
  }),
}))
vi.mock('./useCatalogLanguage.ts', () => ({
  useCatalogLanguage: () => ({ value: 'en-US' }),
}))
function deferred() {
  let resolve!: (value: { items: Backdrop[] }) => void
  const promise = new Promise<{ items: Backdrop[] }>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function select(id: string, ageLimit: number | null) {
  Object.assign(session, { profile: { id, ageLimit } as Profile })
}
beforeEach(() => {
  vi.resetAllMocks()
  select('adult', null)
})
it('drops old-language-identical profile requests and clears visible items synchronously', async () => {
  const adult = deferred()
  const child = deferred()
  mocks.get
    .mockReturnValueOnce(adult.promise)
    .mockReturnValueOnce(child.promise)
  const scope = effectScope()
  const saver = scope.run(useScreensaverBackdrops)!
  select('child', 12)
  expect(saver.items.value).toEqual([])
  child.resolve({ items: [{ id: 'safe' } as Backdrop] })
  await vi.waitFor(() =>
    expect(saver.items.value.map(item => item.id)).toEqual(['safe']),
  )
  adult.resolve({ items: [{ id: 'adult-only' } as Backdrop] })
  await Promise.resolve()
  expect(saver.items.value.map(item => item.id)).toEqual(['safe'])
  const changedAge = deferred()
  mocks.get.mockReturnValueOnce(changedAge.promise)
  select('child', 6)
  expect(saver.items.value).toEqual([])
  expect(mocks.get).toHaveBeenCalledTimes(3)
  scope.stop()
  changedAge.resolve({ items: [{ id: 'stale' } as Backdrop] })
  await Promise.resolve()
  expect(saver.items.value).toEqual([])
})
