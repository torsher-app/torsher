import type {
  FollowSettings,
  UpdateFollowSettingsInput,
} from '@torsher/api-client'
import { api } from '~/services/api'

type LoadState = 'idle' | 'loading' | 'error' | 'ready'

const settings = shallowRef<FollowSettings | null>(null)
const state = ref<LoadState>('idle')

/** «Настройки → Слежу»: лента, бюджет поисков и правила новых слежений */
export function useFollowSettings() {
  async function load() {
    // Показанное остаётся на экране, пока идёт новый запрос, и ошибка его не прячет
    if (state.value !== 'ready')
      state.value = 'loading'

    try {
      settings.value = await withErrorMode('silent', () =>
        api.settings.getFollowSettings())
      state.value = 'ready'
    }
    catch {
      if (state.value === 'loading')
        state.value = 'error'
    }
  }

  /** Каждая карточка сохраняет только своё поле: остальное сервер оставит */
  async function save(body: UpdateFollowSettingsInput) {
    settings.value = await api.settings.putFollowSettings(body)

    return settings.value
  }

  return { settings, state, load, save }
}
