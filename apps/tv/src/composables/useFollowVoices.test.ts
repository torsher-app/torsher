import type { FollowVoicesResponse } from '@torsher/api-client'
import { effectScope, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useFollowVoices } from './useFollowVoices.ts'

const { get, dispose } = vi.hoisted(() => ({
  get: vi.fn(),
  dispose: [] as (() => void)[],
}))
vi.mock('../api.ts', () => ({ api: { titles: { getFollowVoices: get } } }))
vi.mock('vue', async original => ({
  ...(await original<typeof import('vue')>()),
  onBeforeUnmount: (fn: () => void) => dispose.push(fn),
}))
const result: FollowVoicesResponse = {
  season: 2,
  updatedAt: null,
  stale: true,
  cache: 'miss',
  indexerCount: 1,
  failed: [],
  items: [
    {
      studio: 'Studio A',
      types: [],
      count: 0,
      seeders: 0,
      found: false,
      saved: true,
      inherited: false,
    },
  ],
}
beforeEach(() => {
  get.mockReset()
  dispose.length = 0
})

function setup(canEdit = true) {
  const scope = effectScope()
  const title = ref('title')
  const season = ref(2)
  const state = scope.run(() => useFollowVoices(title, season, ref(canEdit)))!
  return {
    state,
    title,
    season,
    stop: () => {
      dispose.forEach(fn => fn())
      scope.stop()
    },
  }
}

describe('follow studio list', () => {
  it('opens without search and requires an explicit refresh', async () => {
    get.mockResolvedValue(result)
    const { state, stop } = setup()
    expect(get).not.toHaveBeenCalled()
    await state.load()
    expect(get).toHaveBeenCalledExactlyOnceWith('title', { season: 2 })
    await state.load(true)
    expect(get).toHaveBeenLastCalledWith('title', { season: 2, refresh: '1' })
    stop()
  })
  it('keeps saved and cached choices after a failed refresh', async () => {
    get
      .mockResolvedValueOnce(result)
      .mockRejectedValueOnce(new Error('offline'))
    const { state, stop } = setup()
    await state.load()
    await state.load(true)
    expect(state.error.value).toBe(true)
    expect(state.data.value).toEqual(result)
    stop()
  })
  it('rejects late results for a different season and deduplicates repeated OK', async () => {
    let finish!: (value: FollowVoicesResponse) => void
    get
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve
        }),
      )
      .mockResolvedValueOnce({ ...result, season: 3 })
    const { state, season, stop } = setup()
    const old = state.load(true)
    await state.load(true)
    expect(get).toHaveBeenCalledTimes(1)
    season.value = 3
    await state.load()
    finish(result)
    await old
    expect(state.data.value?.season).toBe(3)
    stop()
  })
  it('does not read or search for a restricted profile', async () => {
    const { state, stop } = setup(false)
    await state.load()
    await state.load(true)
    expect(get).not.toHaveBeenCalled()
    stop()
  })
  it('ignores the response after closing the panel', async () => {
    let finish!: (value: FollowVoicesResponse) => void
    get.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const { state, stop } = setup()
    const pending = state.load()
    stop()
    finish(result)
    await pending
    expect(state.data.value).toBeUndefined()
  })
})
