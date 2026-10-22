import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createShutdown } from './shutdown.ts'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })

  return { promise, resolve }
}

describe('createShutdown', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('шаги по очереди, затем exit(0) без kill', async () => {
    const order: string[] = []
    const kill = vi.fn()
    const exit = vi.fn()
    const shutdown = createShutdown({
      steps: [
        async () => {
          order.push('sessions')
        },
        async () => {
          order.push('engine')
        },
      ],
      kill,
      exit,
    })

    shutdown()
    await vi.runAllTimersAsync()

    expect(order).toEqual(['sessions', 'engine'])
    expect(exit).toHaveBeenCalledExactlyOnceWith(0)
    expect(kill).not.toHaveBeenCalled()
  })

  it('второй сигнал во время остановки — kill и exit(1), шаги не повторяются', async () => {
    const step = deferred()
    const first = vi.fn(() => step.promise)
    const kill = vi.fn()
    const exit = vi.fn()
    const shutdown = createShutdown({ steps: [first], kill, exit })

    shutdown()
    shutdown()

    expect(first).toHaveBeenCalledOnce()
    expect(kill).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledExactlyOnceWith(1)

    step.resolve()
    await vi.runAllTimersAsync()

    expect(exit).toHaveBeenCalledOnce()
  })

  it('зависший шаг — kill по таймауту', async () => {
    const kill = vi.fn()
    const exit = vi.fn()
    const shutdown = createShutdown({
      steps: [() => new Promise(() => {})],
      kill,
      exit,
      timeoutMs: 15_000,
    })

    shutdown()
    await vi.advanceTimersByTimeAsync(14_999)
    expect(kill).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(kill).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledExactlyOnceWith(1)
  })

  it('ошибка шага — kill и exit(1)', async () => {
    const kill = vi.fn()
    const exit = vi.fn()
    const onError = vi.fn()
    const later = vi.fn()
    const shutdown = createShutdown({
      steps: [() => Promise.reject(new Error('boom')), later],
      kill,
      exit,
      onError,
    })

    shutdown()
    await vi.runAllTimersAsync()

    expect(later).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledOnce()
    expect(kill).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledExactlyOnceWith(1)
  })
})
