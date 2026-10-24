import type { ErrorMode } from './client.ts'

export interface ErrorModeStack {
  /** Режим самого позднего незакончившегося `run`, без него — по умолчанию */
  current: () => ErrorMode
  run: <T>(mode: ErrorMode, fn: () => Promise<T>) => Promise<T>
}

/**
 * Режимы ошибок вложенных и параллельных вызовов. Закончившийся `run`
 * убирает только свою запись: «вернуть прежний режим» при пересечении
 * (A начался, B начался, A закончился) оставил бы режим A навсегда
 */
export function createErrorModeStack(defaultMode: ErrorMode): ErrorModeStack {
  const entries: Array<{ mode: ErrorMode }> = []

  return {
    current: () =>
      entries.length ? entries[entries.length - 1]!.mode : defaultMode,
    async run(mode, fn) {
      const entry = { mode }

      entries.push(entry)

      try {
        return await fn()
      }
      finally {
        const index = entries.indexOf(entry)

        if (index !== -1)
          entries.splice(index, 1)
      }
    },
  }
}
