import type {
  ChangeEmailInput,
  ChangePasswordInput,
  MeResponse,
} from '@torsher/api-client'
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

  async function updateName(name: string) {
    user.value = await api.users.patchUsersMe({ name })
  }

  // Сервер выдаёт текущей сессии новые cookie, прочие сессии выходят
  async function changePassword(body: ChangePasswordInput) {
    await api.users.putUsersMePassword(body)
  }

  async function changeEmail(body: ChangeEmailInput) {
    user.value = await api.users.putUsersMeEmail(body)
  }

  // После выхода гость известен: профиль не перезапрашиваем, вход открывается сразу
  function reset() {
    user.value = null
    isLoaded.value = true
  }

  return {
    user: readonly(user),
    isLoaded: readonly(isLoaded),
    isAuthenticated,
    fetchMe,
    updateName,
    changePassword,
    changeEmail,
    reset,
  }
}
