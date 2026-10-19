import { toast } from 'vue-sonner'
import { createApiClient } from './client'

export { getErrorMessage } from './client'
export type { ErrorMode } from './client'

export const api = createApiClient({
  baseUrl: '/api',
  getErrorMode: () => useErrorMode().value,
  onSessionExpired: () => useAuth().clearSession(),
  onError: message => toast.error(message),
  onFatal: statusCode => showError({ statusCode }),
})
