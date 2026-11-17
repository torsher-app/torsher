import type { NetCheckState } from '@torsher/api-client'
import { computed, readonly, ref, shallowRef } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  postNetCheck: vi.fn(),
  getNetCheck: vi.fn(),
  patchNetRoute: vi.fn(),
}))

vi.mock('~/services/api', () => ({ api: { net: api } }))

beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  vi.useFakeTimers()
  for (const [name, value] of Object.entries({
    computed,
    readonly,
    ref,
    shallowRef,
  }))
    vi.stubGlobal(name, value)
  vi.stubGlobal('withErrorMode', (_mode: string, action: () => unknown) =>
    action())
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it.each([false, true])(
  'settles an invalidated check without a success result: changed=%s',
  async (changed) => {
    const running: NetCheckState = {
      running: true,
      done: 0,
      total: 1,
      finishedAt: null,
      hosts: [],
    }
    const finished = {
      ...running,
      running: false,
      done: 1,
      finishedAt: changed ? null : '2026-11-17T12:00:00.000Z',
    }
    api.postNetCheck.mockResolvedValue(running)
    api.getNetCheck.mockResolvedValue(finished)
    api.patchNetRoute.mockResolvedValue({ id: 'route' })
    const network = (await import('./useNetwork')).useNetwork()
    const { done } = await network.checkAll()

    if (changed)
      await network.updateRoute('route', { proxy: '127.0.0.1:9' })

    await vi.advanceTimersByTimeAsync(1000)
    expect(await done).toEqual(changed ? null : finished)
    expect(network.check.value).toEqual(finished)
    expect(network.isChecking.value).toBe(false)
  },
)
