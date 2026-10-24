export interface ShutdownOptions {
  /** Шаги мягкой остановки — по очереди */
  steps: Array<() => Promise<unknown>>
  /** Жёсткая остановка дочерних процессов, когда ждать уже нельзя */
  kill: () => void
  exit: (code: number) => void
  timeoutMs?: number
  onError?: (err: unknown) => void
}

const DEFAULT_TIMEOUT_MS = 15_000

/**
 * Обработчик сигналов остановки. Первый сигнал запускает шаги; повторный
 * сигнал, ошибка шага или таймаут — жёсткий выход: Node, убитый вторым
 * Ctrl+C, событие `exit` не получает, и движок пережил бы сервер.
 */
export function createShutdown(options: ShutdownOptions) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  let started = false
  let finished = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let successCode = 0

  function finish(code: number) {
    if (finished)
      return

    finished = true
    clearTimeout(timer)

    if (code !== successCode)
      options.kill()

    options.exit(code)
  }

  async function run() {
    try {
      for (const step of options.steps) {
        await step()

        if (finished)
          return
      }

      finish(successCode)
    }
    catch (err) {
      options.onError?.(err)
      finish(1)
    }
  }

  // Код успешной остановки: перезапуск после восстановления выходит с
  // ненулевым, чтобы Docker поднял контейнер и при `restart: on-failure`
  return (exitCode = 0) => {
    if (started) {
      finish(1)
      return
    }

    started = true
    successCode = exitCode
    timer = setTimeout(finish, timeoutMs, 1)
    void run()
  }
}
