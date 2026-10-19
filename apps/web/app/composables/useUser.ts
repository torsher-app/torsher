import type { MeResponse } from '@torsher/api-client'
import { api } from '~/services/api'

// Состояние живёт в модуле, а не в Pinia: приложению нужен один
// экземпляр на вкладку, а SPA всё равно не делит стейт между запросами
const user = shallowRef<MeResponse | null>(null)
const isLoaded = ref(false)

export function useUser() {
  const isAuthenticated = computed(() => user.value !== null)

  async function fetchMe() {
    try {
      user.value = await withErrorMode('silent', () => api.users.getUsersMe())
    }
    catch {
      user.value = null
    }
    finally {
      isLoaded.value = true
    }

    return user.value
  }

  function reset() {
    user.value = null
    isLoaded.value = false
  }

  return {
    user: readonly(user),
    isLoaded: readonly(isLoaded),
    isAuthenticated,
    fetchMe,
    reset,
  }
}
