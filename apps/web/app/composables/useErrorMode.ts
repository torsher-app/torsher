import type { ErrorMode } from '~/services/api'

const errorMode = ref<ErrorMode>('toast')

/**
 * Как API-клиент показывает ошибку ответа:
 * - `toast` — всплывающее уведомление (по умолчанию);
 * - `global` — страница ошибки;
 * - `silent` — ничего, вызывающий код разбирается сам.
 */
export function useErrorMode() {
  return errorMode
}

/** Выполняет запрос в заданном режиме и возвращает режим обратно */
export async function withErrorMode<T>(mode: ErrorMode, fn: () => Promise<T>) {
  const previous = errorMode.value

  errorMode.value = mode

  try {
    return await fn()
  }
  finally {
    errorMode.value = previous
  }
}
