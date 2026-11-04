import type { MaintenanceStatus } from '@torsher/api-client'
import { getErrorMessage, getErrorStatus } from '@torsher/api-client'
import { api } from '~/services/api'

export function useMaintenanceExecution() {
  const status = shallowRef<MaintenanceStatus | null>(null)
  const busy = ref(false)
  const error = ref('')
  const detail = ref('')
  let disposed = false
  async function run(action: () => Promise<MaintenanceStatus>) {
    busy.value = true
    error.value = ''
    detail.value = ''
    try {
      const result = await withErrorMode('silent', action)
      if (!disposed)
        status.value = result
      return !disposed
    }
    catch (cause) {
      const message = await getErrorMessage(cause)
      if (!disposed) {
        error.value = getErrorStatus(cause) === 409 ? 'conflict' : 'error'
        detail.value = message
      }
      return false
    }
    finally {
      busy.value = false
    }
  }
  const load = () =>
    run(() => api.libraryMaintenance.getLibraryMaintenanceStatus())
  const toggle = (enabled: boolean) =>
    run(() =>
      api.libraryMaintenance.setLibraryMaintenanceExecution({ enabled }),
    )
  const retry = (id: string) =>
    run(() => api.libraryMaintenance.retryLibraryMaintenanceOperation(id))
  const acknowledge = () =>
    run(() => api.libraryMaintenance.acknowledgeLibraryMaintenanceRestore())
  const cancelFence = (id: string) =>
    run(() => api.libraryMaintenance.cancelLibraryMaintenanceExternalFence(id))
  onMounted(load)
  onBeforeUnmount(() => {
    disposed = true
  })
  return {
    status,
    busy,
    error,
    detail,
    load,
    toggle,
    retry,
    acknowledge,
    cancelFence,
  }
}
