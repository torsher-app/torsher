import type { ScreensaverDebugEvent } from '../inputDebug.ts'

type VideoEvent = Extract<ScreensaverDebugEvent, { kind: 'video' }>
const STALL_MS = 15_000
const RETRY_MS = [2000, 5000, 15_000, 60_000]

/** Одна сессия, один watchdog и одна текущая попытка; play() может не завершиться. */
export function startScreensaverVideo(
  video: HTMLVideoElement,
  src: string,
  report?: (event: VideoEvent) => void,
): () => void {
  const startedAt = Date.now()
  let released = false
  let generation = 0
  let pending = false
  let rejected = false
  let changingSource = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastTime = video.currentTime
  let lastProgressAt = startedAt
  let retryAt: number | undefined
  let retryStep = 0
  let reload = false
  let faulted = false
  let progressed = false

  function emit(status: VideoEvent['status'], code?: number) {
    report?.({
      kind: 'video',
      status,
      elapsed: Date.now() - startedAt,
      ...(code === undefined ? {} : { code }),
    })
  }

  function sample() {
    const time = video.currentTime
    // В том числе переход с конца loop в начало. playing/play resolution не доказательство.
    if (Number.isFinite(time) && Math.abs(time - lastTime) >= 0.01) {
      lastTime = time
      lastProgressAt = Date.now()
      if (!video.paused && !video.error) {
        retryAt = undefined
        reload = false
        retryStep = 0
        if (pending) {
          pending = false
          generation++
        }
        if (faulted)
          emit('recovered')
        else if (!progressed)
          emit('progress')
        faulted = false
        progressed = true
      }
    }
  }

  function fault(
    status: 'pause' | 'rejected' | 'error' | 'stall',
    hard: boolean,
  ) {
    if (released || changingSource)
      return
    reload ||= hard
    if (retryAt !== undefined)
      return
    faulted = true
    emit(status, status === 'error' ? video.error?.code : undefined)
    retryAt
      = Date.now() + RETRY_MS[Math.min(retryStep++, RETRY_MS.length - 1)]!
  }

  function attempt(reset: boolean) {
    const current = ++generation
    pending = true
    rejected = false
    lastProgressAt = Date.now()
    if (reset) {
      changingSource = true
      video.load()
      lastTime = video.currentTime
      changingSource = false
    }
    // На старых webOS muted в разметке не всегда выставляет свойство.
    video.muted = true
    try {
      const result = video.play()
      // Старые media implementations могут не возвращать Promise.
      result?.then(
        () => {
          if (released || generation !== current)
            return
          pending = false
        },
        () => {
          if (released || generation !== current)
            return
          pending = false
          rejected = true
          fault('rejected', false)
        },
      )
    }
    catch {
      pending = false
      rejected = true
      fault('rejected', false)
    }
  }

  function tick() {
    if (released)
      return
    sample()
    if (video.error) {
      fault('error', true)
    }
    else if (
      (pending || !video.paused || !rejected)
      && Date.now() - lastProgressAt >= STALL_MS
    ) {
      fault('stall', true)
    }
    else if (video.paused && !pending) {
      fault('pause', false)
    }

    if (retryAt !== undefined && Date.now() >= retryAt) {
      const reset = reload
      retryAt = undefined
      reload = false
      emit('retry')
      attempt(reset)
    }
    timer = setTimeout(tick, 1000)
  }
  function onPause() {
    if (!pending)
      fault('pause', false)
  }
  function onError() {
    fault('error', true)
  }
  function onProgress() {
    if (!released)
      sample()
  }

  video.addEventListener('pause', onPause)
  video.addEventListener('error', onError)
  video.addEventListener('timeupdate', onProgress)
  video.muted = true
  video.src = src
  emit('start')
  attempt(false)
  timer = setTimeout(tick, 1000)

  return () => {
    if (released)
      return
    released = true
    generation++
    clearTimeout(timer)
    video.removeEventListener('pause', onPause)
    video.removeEventListener('error', onError)
    video.removeEventListener('timeupdate', onProgress)
    emit('release')
    video.pause()
    video.removeAttribute('src')
    video.load()
  }
}
