import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { startScreensaverVideo } from './screensaverVideo.ts'

class Video extends EventTarget {
  currentTime = 0
  paused = true
  muted = false
  src = ''
  error: { code: number } | null = null
  play = vi.fn((): Promise<void> => {
    this.paused = false
    return Promise.resolve()
  })

  pause = vi.fn(() => {
    this.paused = true
    this.dispatchEvent(new Event('pause'))
  })

  load = vi.fn(() => {
    this.currentTime = 0
  })

  removeAttribute = vi.fn(() => {
    this.src = ''
  })

  progress(time: number) {
    this.currentTime = time
    this.dispatchEvent(new Event('timeupdate'))
  }
}
let video: Video
let release: () => void
const report = vi.fn()
beforeEach(() => {
  vi.useFakeTimers()
  video = new Video()
  report.mockClear()
})
afterEach(() => {
  release?.()
  vi.useRealTimers()
})
function start() {
  release = startScreensaverVideo(
    video as unknown as HTMLVideoElement,
    '/local.mp4',
    report,
  )
}
function deferred() {
  let resolve!: () => void
  let reject!: () => void
  const promise = new Promise<void>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
it('retries rejected play softly at 2/5/15/60 seconds, coalescing event storms', async () => {
  video.play.mockRejectedValue(new Error('blocked'))
  start()
  await Promise.resolve()
  expect(video.muted).toBe(true)
  for (const delay of [2000, 5000, 15_000, 60_000, 60_000]) {
    const calls = video.play.mock.calls.length
    for (let i = 0; i < 10; i++) video.dispatchEvent(new Event('pause'))
    await vi.advanceTimersByTimeAsync(delay - 1)
    expect(video.play).toHaveBeenCalledTimes(calls)
    await vi.advanceTimersByTimeAsync(1)
    expect(video.play).toHaveBeenCalledTimes(calls + 1)
  }
  expect(video.load).not.toHaveBeenCalled()
})
it('reloads a never-settling first play after the stall deadline', async () => {
  const old = deferred()
  video.play.mockReturnValueOnce(old.promise)
  start()
  await vi.advanceTimersByTimeAsync(16_999)
  expect(video.play).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(video.load).toHaveBeenCalledTimes(1)
  expect(video.play).toHaveBeenCalledTimes(2)
  old.reject()
  await Promise.resolve()
  expect(
    report.mock.calls.filter(([e]) => e.status === 'rejected'),
  ).toHaveLength(0)
})
it('softly resumes a pause, but reloads media errors and confirmed stalls', async () => {
  start()
  await Promise.resolve()
  video.progress(1)
  video.pause()
  await vi.advanceTimersByTimeAsync(2000)
  expect(video.play).toHaveBeenCalledTimes(2)
  expect(video.load).not.toHaveBeenCalled()
  video.progress(2)
  video.error = { code: 3 }
  video.dispatchEvent(new Event('error'))
  await vi.advanceTimersByTimeAsync(2000)
  expect(video.load).toHaveBeenCalledTimes(1)
  video.error = null
  video.progress(1)
  await vi.advanceTimersByTimeAsync(17_000)
  expect(video.load).toHaveBeenCalledTimes(2)
})
it('recognizes healthy loops without retries and logs progress only once', async () => {
  start()
  for (let i = 0; i < 40; i++) {
    video.progress((i % 10) + 0.1)
    await vi.advanceTimersByTimeAsync(1000)
  }
  expect(video.play).toHaveBeenCalledTimes(1)
  expect(
    report.mock.calls.filter(([e]) => e.status === 'progress'),
  ).toHaveLength(1)
})
it('cancels a retry when real playback recovers before its deadline', async () => {
  start()
  await Promise.resolve()
  video.pause()
  await vi.advanceTimersByTimeAsync(1000)
  video.paused = false
  video.progress(2)
  await vi.advanceTimersByTimeAsync(1000)
  expect(video.play).toHaveBeenCalledTimes(1)
  expect(report.mock.calls.some(([e]) => e.status === 'recovered')).toBe(true)
})
it('late promises and events cannot revive released resources or affect a newer session', async () => {
  const old = deferred()
  video.play.mockReturnValueOnce(old.promise)
  start()
  release()
  release()
  expect(video.pause).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(0)
  start()
  old.reject()
  await Promise.resolve()
  video.progress(1)
  await vi.advanceTimersByTimeAsync(2000)
  expect(video.play).toHaveBeenCalledTimes(2)
  release()
  video.dispatchEvent(new Event('error'))
  await vi.advanceTimersByTimeAsync(120_000)
  expect(video.play).toHaveBeenCalledTimes(2)
  expect(vi.getTimerCount()).toBe(0)
})
it('does not overlap a pending play with soft pause retries', async () => {
  const pending = deferred()
  video.play.mockReturnValueOnce(pending.promise)
  start()
  video.pause()
  await vi.advanceTimersByTimeAsync(14_999)
  expect(video.play).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(2001)
  expect(video.play).toHaveBeenCalledTimes(2)
  expect(video.load).toHaveBeenCalledTimes(1)
  pending.resolve()
  await Promise.resolve()
})
it('eventually reloads a paused video whose successful soft plays never advance time', async () => {
  video.play.mockImplementation(() => Promise.resolve())
  start()
  await vi.advanceTimersByTimeAsync(25_000)
  expect(video.load).toHaveBeenCalledTimes(1)
})
it('resets retry delay only after real progress, not play resolution', async () => {
  video.play.mockRejectedValueOnce(new Error('blocked'))
  start()
  await vi.advanceTimersByTimeAsync(2000)
  video.pause()
  await vi.advanceTimersByTimeAsync(2000)
  expect(video.play).toHaveBeenCalledTimes(2)
  video.paused = false
  video.progress(1)
  video.pause()
  await vi.advanceTimersByTimeAsync(2000)
  expect(video.play).toHaveBeenCalledTimes(3)
})
