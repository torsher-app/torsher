import { createApiClient, getErrorStatus } from '@torsher/api-client'
import { toLoadError } from './lib/loadError.ts'

let sessionExpired = () => {}

/**
 * Сессия кончилась посреди работы: устройство отключили в панели или у
 * владельца не обновился вход. Обработчик ставит `main.ts`, чтобы клиент API
 * не зависел от роутера.
 */
export function onSessionExpired(handler: () => void) {
  sessionExpired = handler
}

// Ошибки показывает сам экран: тостов и страницы ошибки у витрины нет
export const api = createApiClient({
  getErrorMode: () => 'silent',
  onSessionExpired: () => sessionExpired(),
  onError: () => {},
  onFatal: () => {},
})

export function loadErrorOf(err: unknown) {
  return toLoadError(getErrorStatus(err))
}
