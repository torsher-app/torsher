import { toast } from 'vue-sonner'
import { createApiClient } from '@torsher/api-client'

export { getErrorMessage } from '@torsher/api-client'
export type { ErrorMode } from '@torsher/api-client'

export const api = createApiClient({
  getErrorMode: currentErrorMode,
  onSessionExpired: () => useAuth().clearSession(),
  onError: message => toast.error(message),
  onFatal: statusCode => showError({ statusCode }),
})
