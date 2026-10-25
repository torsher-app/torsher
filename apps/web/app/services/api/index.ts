import type { TooManyAttemptsResponse } from '@torsher/api-client'
import { toast } from 'vue-sonner'
import {
  createApiClient,
  getErrorBody,
  getErrorStatus,
} from '@torsher/api-client'

export { getErrorMessage } from '@torsher/api-client'
export type { ErrorMode } from '@torsher/api-client'

export const api = createApiClient({
  getErrorMode: currentErrorMode,
  onSessionExpired: () => useAuth().clearSession(),
  onError: message => toast.error(message),
  onFatal: statusCode => showError({ statusCode }),
})

/**
 * Минуты до следующей попытки, если сервер ограничил попытки ввода пароля
 * (429); иначе `undefined`
 */
export async function retryAfterMinutes(err: unknown) {
  if (getErrorStatus(err) !== 429)
    return undefined

  const body = await getErrorBody<TooManyAttemptsResponse>(err)

  return Math.max(1, Math.ceil((body?.retryAfter ?? 60) / 60))
}
