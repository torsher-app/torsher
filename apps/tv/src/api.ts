import { createApiClient, getErrorStatus } from '@torsher/api-client'
import { toLoadError } from './lib/loadError.ts'

// Ошибки показывает сам экран: тостов и страницы ошибки у витрины нет
export const api = createApiClient({
  getErrorMode: () => 'silent',
  onSessionExpired: () => {},
  onError: () => {},
  onFatal: () => {},
})

export function loadErrorOf(err: unknown) {
  return toLoadError(getErrorStatus(err))
}
