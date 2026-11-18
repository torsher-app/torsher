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

it('does not let an old finished poll replace invalidation after a route save', async () => {
  const running: NetCheckState = {
    running: true,
    done: 0,
    total: 1,
    finishedAt: null,
    hosts: [],
  }
  const invalidated = { ...running, running: false, done: 1 }
  const finished = { ...invalidated, finishedAt: '2026-11-17T12:00:00Z' }
  api.postNetCheck.mockResolvedValue(running)
  let finish!: (value: NetCheckState) => void
  api.getNetCheck.mockReturnValueOnce(
    new Promise<NetCheckState>((resolve) => {
      finish = resolve
    }),
  )
  api.patchNetRoute.mockResolvedValue({ id: 'route' })
  const network = (await import('./useNetwork')).useNetwork()
  const { done } = await network.checkAll()
  await vi.advanceTimersByTimeAsync(1000)
  api.getNetCheck.mockResolvedValue(invalidated)
  await network.updateRoute('route', { proxy: '127.0.0.1:9' })
  finish(finished)
  await vi.advanceTimersByTimeAsync(0)
  expect(await done).toBeNull()
  expect(network.check.value).toEqual(invalidated)
})

it.each([false, true])(
  'settles an active check after a rejected route mutation: already finished=%s',
  async (alreadyFinished) => {
    const running: NetCheckState = {
      running: true,
      done: 0,
      total: 1,
      finishedAt: null,
      hosts: [],
    }
    api.postNetCheck.mockResolvedValue(running)
    const finished = {
      ...running,
      running: false,
      done: 1,
      finishedAt: '2026-11-17T12:00:00Z',
    }
    api.getNetCheck.mockResolvedValue(alreadyFinished ? finished : running)
    api.patchNetRoute.mockRejectedValue(new Error('invalid route'))
    const network = (await import('./useNetwork')).useNetwork()
    const { done } = await network.checkAll()
    await expect(
      network.updateRoute('route', { proxy: 'invalid' }),
    ).rejects.toThrow('invalid route')
    api.getNetCheck.mockResolvedValue(finished)
    await vi.advanceTimersByTimeAsync(1000)
    expect(network.isChecking.value).toBe(false)
    expect((await done)?.finishedAt).toBe('2026-11-17T12:00:00Z')
  },
)

it('discards a completed green snapshot immediately when changed routes cannot be reread', async () => {
  const finished: NetCheckState = {
    running: false,
    done: 1,
    total: 1,
    finishedAt: '2026-11-17T12:00:00Z',
    hosts: [],
  }
  api.postNetCheck.mockResolvedValue(finished)
  api.getNetCheck.mockResolvedValue(finished)
  api.patchNetRoute.mockResolvedValue({ id: 'route' })
  const network = (await import('./useNetwork')).useNetwork()
  const { done } = await network.checkAll()
  await vi.advanceTimersByTimeAsync(1000)
  await done
  api.getNetCheck.mockRejectedValueOnce(new Error('offline'))
  await network.updateRoute('route', { proxy: '127.0.0.1:9' })
  expect(network.check.value).toBeNull()
  const invalidated = { ...finished, finishedAt: null }
  api.getNetCheck.mockResolvedValue(invalidated)
  await vi.advanceTimersByTimeAsync(1000)
  expect(network.check.value).toEqual(invalidated)
})

const running: NetCheckState = {
  running: true,
  done: 0,
  total: 1,
  finishedAt: null,
  hosts: [],
}
const finished: NetCheckState = {
  ...running,
  running: false,
  done: 1,
  finishedAt: '2026-11-17T12:00:00Z',
}

it('keeps waiting for a new check when an earlier route save is acknowledged late', async () => {
  const saved = Promise.withResolvers<{ id: string }>()
  api.patchNetRoute.mockReturnValue(saved.promise)
  api.postNetCheck.mockResolvedValue(running)
  api.getNetCheck.mockResolvedValue(running)
  const network = (await import('./useNetwork')).useNetwork()
  const save = network.updateRoute('route', { proxy: '127.0.0.1:9' })
  // The server has applied the route, but its ACK has not arrived.
  const { done } = await network.checkAll()
  const onDone = vi.fn()
  void done.then(onDone)

  saved.resolve({ id: 'route' })
  await save
  await vi.advanceTimersByTimeAsync(1000)
  expect(onDone).not.toHaveBeenCalled()
  expect(api.getNetCheck).toHaveBeenCalledTimes(1)
  api.getNetCheck.mockResolvedValue(finished)
  await vi.advanceTimersByTimeAsync(1000)
  expect(await done).toEqual(finished)
})

it('does not start another read or timer when a route save is acknowledged after stop', async () => {
  const saved = Promise.withResolvers<{ id: string }>()
  api.patchNetRoute.mockReturnValue(saved.promise)
  api.getNetCheck.mockResolvedValue(running)
  const network = (await import('./useNetwork')).useNetwork()
  const save = network.updateRoute('route', { proxy: '127.0.0.1:9' })
  network.stopPolling()
  saved.resolve({ id: 'route' })
  await save

  expect(api.getNetCheck).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)

  api.postNetCheck.mockResolvedValue(running)
  api.getNetCheck.mockResolvedValue(finished)
  const { done } = await network.checkAll()
  await vi.advanceTimersByTimeAsync(1000)
  expect(await done).toEqual(finished)
})

it.each([false, true])(
  'keeps the all-host waiter through a single-host POST: successful=%s',
  async (successful) => {
    const host = Promise.withResolvers<NetCheckState>()
    api.postNetCheck
      .mockResolvedValueOnce(running)
      .mockReturnValueOnce(host.promise)
    api.getNetCheck.mockResolvedValue(running)
    const network = (await import('./useNetwork')).useNetwork()
    const { done } = await network.checkAll()
    const onDone = vi.fn()
    void done.then(onDone)
    const single = network.checkHost('host')

    await vi.advanceTimersByTimeAsync(1000)
    expect(api.getNetCheck).toHaveBeenCalledTimes(1)
    expect(onDone).not.toHaveBeenCalled()
    if (successful) {
      host.resolve(running)
      await single
    }
    else {
      host.reject(new Error('host POST failed'))
      await expect(single).rejects.toThrow('host POST failed')
    }

    api.getNetCheck.mockResolvedValue(finished)
    await vi.advanceTimersByTimeAsync(1000)
    expect(await done).toEqual(finished)
  },
)

it('ignores a rejected old poll after a successful single-host check replaces it', async () => {
  const oldRead = Promise.withResolvers<NetCheckState>()
  api.postNetCheck.mockResolvedValue(running)
  api.getNetCheck.mockReturnValueOnce(oldRead.promise)
  const network = (await import('./useNetwork')).useNetwork()
  const { done } = await network.checkAll()
  await vi.advanceTimersByTimeAsync(1000)
  await network.checkHost('host')
  oldRead.reject(new Error('old GET failed'))
  await vi.advanceTimersByTimeAsync(0)
  api.getNetCheck.mockResolvedValue(finished)
  await vi.advanceTimersByTimeAsync(1000)
  expect(await done).toEqual(finished)
})

it.each(['stop', 'new check'])(
  'ignores an older single-host response after %s',
  async (interruption) => {
    const host = Promise.withResolvers<NetCheckState>()
    api.postNetCheck
      .mockReturnValueOnce(host.promise)
      .mockResolvedValueOnce(running)
    const network = (await import('./useNetwork')).useNetwork()
    const single = network.checkHost('host')
    const next
      = interruption === 'stop'
        ? network.stopPolling()
        : await network.checkAll()

    host.resolve(finished)
    await single
    expect(api.getNetCheck).not.toHaveBeenCalled()
    if (next) {
      expect(network.check.value).toEqual(running)
      api.getNetCheck.mockResolvedValue(finished)
      await vi.advanceTimersByTimeAsync(1000)
      expect(await next.done).toEqual(finished)
    }
    else {
      expect(network.check.value).toBeNull()
      expect(vi.getTimerCount()).toBe(0)
    }
  },
)
