import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb, migrateDb } from '../../db/index.ts'
import { profiles } from '../../db/schema.ts'
import {
  allowedTitleIds,
  filterTitles,
  titleAllowed,
  titleAllowedCached,
} from './access.ts'

const mocks = vi.hoisted(() => ({ age: vi.fn(), cached: vi.fn() }))
vi.mock('../tmdb/certification.ts', async original => ({
  ...(await original<typeof import('../tmdb/certification.ts')>()),
  cachedTitleAge: mocks.cached,
  loadTitleAge: mocks.age,
}))
let child: string
let adult: string
beforeAll(async () => {
  await migrateDb()
  child = getDb()
    .insert(profiles)
    .values({ name: 'Child', color: 'violet', ageLimit: 12 })
    .returning()
    .get()
    .id
  adult = getDb()
    .insert(profiles)
    .values({ name: 'Adult', color: 'violet' })
    .returning()
    .get()
    .id
})
beforeEach(() => vi.resetAllMocks())

describe('profile access policy', () => {
  it('hides threshold equality and missing classification', async () => {
    mocks.age.mockImplementation(
      async id => ({ younger: 6, equal: 12, older: 18 })[id as string],
    )
    expect([
      ...(await allowedTitleIds(child, [
        'younger',
        'equal',
        'older',
        'unknown',
        null,
      ])),
    ]).toEqual(['younger'])
    expect(await titleAllowed(child, null)).toBe(false)
    expect(await titleAllowed(child, 'equal')).toBe(false)
  })
  it('has no classification requests without a limit, including an unclassified source', async () => {
    expect([...(await allowedTitleIds(adult, ['unknown']))]).toEqual([
      'unknown',
    ])
    expect(await titleAllowed(adult, null)).toBe(true)
    expect(titleAllowedCached(adult, null)).toBe(true)
    expect(mocks.age).not.toHaveBeenCalled()
    expect(mocks.cached).not.toHaveBeenCalled()
  })
  it('fails closed for a deleted profile in every entry point', async () => {
    expect(
      await filterTitles('missing', [{ id: 'younger' }], item => item.id),
    ).toEqual([])
    expect([...(await allowedTitleIds('missing', ['younger']))]).toEqual([])
    expect(await titleAllowed('missing', 'younger')).toBe(false)
    expect(titleAllowedCached('missing', 'younger')).toBe(false)
    expect(mocks.age).not.toHaveBeenCalled()
  })
  it('caps a cold combined response at six fetches and deduplicates simultaneous rows', async () => {
    let active = 0
    let peak = 0
    mocks.age.mockImplementation(async () => {
      peak = Math.max(peak, ++active)
      await new Promise(resolve => setTimeout(resolve, 1))
      active--
      return 6
    })
    const ids = Array.from({ length: 24 }, (_, i) => `title-${i}`)
    await Promise.all([
      allowedTitleIds(child, ids),
      allowedTitleIds(child, ids.slice(8)),
      Promise.resolve().then(() =>
        allowedTitleIds(child, ['late-one', 'late-two']),
      ),
    ])
    expect(peak).toBe(6)
    expect(mocks.age).toHaveBeenCalledTimes(26)
  })
  it('reserves a released slot before a new request races the awakened waiter', async () => {
    let active = 0
    let peak = 0
    const gates: Array<() => void> = []
    mocks.age.mockImplementation(() => {
      peak = Math.max(peak, ++active)
      return new Promise<number>(resolve =>
        gates.push(() => {
          active--
          resolve(6)
        }),
      )
    })
    const first = allowedTitleIds(
      child,
      Array.from({ length: 8 }, (_, i) => `race-${i}`),
    )
    await vi.waitFor(() => expect(gates).toHaveLength(6))
    gates.shift()!()
    // Runs after release, before the previously queued waiter resumes.
    const late = Promise.resolve().then(() =>
      allowedTitleIds(child, ['race-late']),
    )
    await vi.waitFor(() => expect(mocks.age).toHaveBeenCalledTimes(7))
    for (let finished = 1; finished < 9; finished++) {
      await vi.waitFor(() => expect(gates.length).toBeGreaterThan(0))
      gates.shift()!()
      await Promise.resolve()
    }
    expect((await first).size).toBe(8)
    expect((await late).size).toBe(1)
    expect(peak).toBe(6)
  })
  it('hot stream policy only reads the cached classification', () => {
    mocks.cached.mockReturnValue(6)
    for (let i = 0; i < 30; i++)
      expect(titleAllowedCached(child, 'younger')).toBe(true)
    expect(mocks.age).not.toHaveBeenCalled()
    mocks.cached.mockReturnValue(undefined)
    expect(titleAllowedCached(child, 'unknown')).toBe(false)
  })
  it('does not swallow programming errors', async () => {
    mocks.age.mockRejectedValue(new TypeError('invalid metadata'))
    await expect(titleAllowed(child, 'bad')).rejects.toThrow(
      'invalid metadata',
    )
  })
})
