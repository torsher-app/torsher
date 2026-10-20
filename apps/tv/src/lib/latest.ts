export type Outcome<T>
  = | { status: 'done', value: T }
    | { status: 'failed', error: unknown }
    | { status: 'cancelled' }

/**
 * В силе только последний запуск: новый отменяет предыдущий, и ответ
 * устаревшего запроса не перезапишет свежий результат.
 */
export function createLatest() {
  let controller: AbortController | undefined

  function cancel() {
    controller?.abort()
    controller = undefined
  }

  async function run<T>(
    task: (signal: AbortSignal) => Promise<T>,
  ): Promise<Outcome<T>> {
    cancel()

    const current = new AbortController()

    controller = current

    try {
      const value = await task(current.signal)

      return current.signal.aborted
        ? { status: 'cancelled' }
        : { status: 'done', value }
    }
    catch (error) {
      return current.signal.aborted
        ? { status: 'cancelled' }
        : { status: 'failed', error }
    }
  }

  return { run, cancel }
}
