import type { ErrorMode } from '~/services/api'
import { createErrorModeStack } from '@torsher/api-client'

/**
 * Как API-клиент показывает ошибку ответа:
 * - `toast` — всплывающее уведомление (по умолчанию);
 * - `global` — страница ошибки;
 * - `silent` — ничего, вызывающий код разбирается сам.
 */
const errorModes = createErrorModeStack('toast')

/** Режим для запроса, который начинается сейчас */
export function currentErrorMode() {
  return errorModes.current()
}

/** Выполняет запросы внутри `fn` в заданном режиме */
export function withErrorMode<T>(mode: ErrorMode, fn: () => Promise<T>) {
  return errorModes.run(mode, fn)
}
