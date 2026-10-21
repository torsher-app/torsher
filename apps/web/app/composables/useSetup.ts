import { api } from '~/services/api'

// null — ещё не спрашивали сервер
const needsSetup = ref<boolean | null>(null)

/**
 * Аккаунт на сервере один и создаётся при первом запуске: пока его нет,
 * вместо входа панель показывает создание аккаунта.
 */
export function useSetup() {
  async function load() {
    if (needsSetup.value === null) {
      try {
        const res = await withErrorMode('silent', () =>
          api.auth.getAuthSetup())

        needsSetup.value = res.needsSetup
      }
      catch {
        // Сервер недоступен: показываем вход, его ошибка объяснит остальное
        return false
      }
    }

    return needsSetup.value
  }

  function markDone() {
    needsSetup.value = false
  }

  return { load, markDone }
}
