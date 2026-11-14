import type { InternetSpeedtest } from './generated'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createInternetSpeedtest } from './speedtest'

const phase = {
  bytesPerSecond: null,
  durationMs: 0,
  payloadBytes: 0,
  confirmedBytes: 0,
  reservedBytes: 0,
  shortened: false,
}
const result: InternetSpeedtest = {
  id: 'run',
  startedAt: '2026-01-01T00:00:00Z',
  finishedAt: null,
  state: 'running',
  phase: 'latency',
  reason: null,
  provider: 'Cloudflare',
  route: 'direct',
  dns: 'system',
  latencyMs: null,
  download: phase,
  upload: phase,
  samples: [],
}
function fixture() {
  const calls = {
    start: vi.fn(async () => result),
    status: vi.fn(async () => result),
    heartbeat: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    update: vi.fn(),
    errorStatus: () => undefined,
  }
  return { calls, runner: createInternetSpeedtest(calls) }
}
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
it('does not require readable streams, and separates 4Hz status from 1Hz heartbeat', async () => {
  vi.stubGlobal('ReadableStream', undefined)
  const { calls, runner } = fixture()
  expect(calls.start).not.toHaveBeenCalled()
  await runner.start()
  await vi.advanceTimersByTimeAsync(1000)
  expect(calls.status).toHaveBeenCalledTimes(4)
  expect(calls.heartbeat).toHaveBeenCalledTimes(1)
  runner.stop()
  expect(vi.getTimerCount()).toBe(0)
})
it('releases late start IDs after the opening screen has stopped', async () => {
  const { calls, runner } = fixture()
  let resolve!: (value: InternetSpeedtest) => void
  calls.start.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  const pending = runner.start()
  runner.stop()
  resolve(result)
  await pending
  expect(calls.cancel).toHaveBeenCalledWith('run')
  expect(calls.update.mock.calls.at(-1)?.[0].status).toBe('cancelled')
})
it('retains all last measurements on stop and clears them only on the next start', async () => {
  const { calls, runner } = fixture()
  calls.start.mockResolvedValue({
    ...result,
    phase: 'upload',
    download: { ...phase, bytesPerSecond: 10 },
    upload: {
      ...phase,
      bytesPerSecond: 20,
      durationMs: 2000,
      payloadBytes: 40,
    },
    samples: [{ phase: 'upload', seconds: 2, bytesPerSecond: 20 }],
  })
  await runner.start()
  runner.stop()
  expect(calls.update.mock.calls.at(-1)?.[0]).toMatchObject({
    status: 'cancelled',
    result: {
      state: 'cancelled',
      download: { bytesPerSecond: 10 },
      upload: { bytesPerSecond: 20, durationMs: 2000, payloadBytes: 40 },
      samples: [{ phase: 'upload', seconds: 2, bytesPerSecond: 20 }],
    },
  })
  calls.start.mockReturnValueOnce(new Promise(() => {}))
  void runner.start()
  expect(calls.update.mock.calls.at(-1)?.[0]).toEqual({
    status: 'preparing',
    error: null,
    result: null,
  })
  runner.stop()
})
it('ignores a late heartbeat rejection after a terminal status response', async () => {
  const { calls, runner } = fixture()
  let reject!: (error: Error) => void
  calls.heartbeat.mockImplementation(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail
      }),
  )
  await runner.start()
  await vi.advanceTimersByTimeAsync(1000)
  calls.status.mockResolvedValue({
    ...result,
    state: 'complete',
    phase: 'finished',
    reason: 'complete',
  })
  await vi.advanceTimersByTimeAsync(250)
  reject(new Error('late heartbeat'))
  await vi.advanceTimersByTimeAsync(0)
  expect(calls.update.mock.calls.at(-1)?.[0]).toMatchObject({
    status: 'complete',
    error: null,
  })
  expect(vi.getTimerCount()).toBe(0)
})
it('does not overlap pending status reads or publish their result after stop', async () => {
  const { calls, runner } = fixture()
  let resolve!: (value: InternetSpeedtest) => void
  calls.status.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  await runner.start()
  await vi.advanceTimersByTimeAsync(2000)
  expect(calls.status).toHaveBeenCalledTimes(1)
  expect(calls.heartbeat).toHaveBeenCalledTimes(2)
  runner.stop()
  resolve({ ...result, state: 'complete' })
  await vi.advanceTimersByTimeAsync(0)
  expect(calls.update.mock.calls.at(-1)?.[0].status).toBe('cancelled')
})
