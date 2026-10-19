import { describe, expect, it } from 'vitest'
import { createLatest } from './latest.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

describe('createLatest', () => {
  it('отдаёт результат единственного запуска', async () => {
    const latest = createLatest()

    expect(await latest.run(async () => 42)).toEqual({
      status: 'done',
      value: 42,
    })
  })

  it('отменяет предыдущий запуск, даже если он ответил позже', async () => {
    const latest = createLatest()
    const slow = deferred<string>()
    let firstSignal: AbortSignal | undefined

    const first = latest.run((signal) => {
      firstSignal = signal

      return slow.promise
    })
    const second = latest.run(async () => 'fresh')

    slow.resolve('stale')

    expect(firstSignal?.aborted).toBe(true)
    expect(await first).toEqual({ status: 'cancelled' })
    expect(await second).toEqual({ status: 'done', value: 'fresh' })
  })

  it('не выдаёт ошибку отменённого запуска', async () => {
    const latest = createLatest()
    const slow = deferred<string>()

    const first = latest.run(() => slow.promise)

    latest.cancel()
    slow.reject(new Error('aborted'))

    expect(await first).toEqual({ status: 'cancelled' })
  })

  it('возвращает ошибку актуального запуска', async () => {
    const latest = createLatest()
    const error = new Error('boom')

    expect(
      await latest.run(async () => {
        throw error
      }),
    ).toEqual({ status: 'failed', error })
  })
})
