import type {
  UpdateSettingsBody,
  UpdateStatusResponse,
} from '@torsher/api-client'
import { api } from '~/services/api'

type LoadState = 'idle' | 'loading' | 'error' | 'ready'

const status = shallowRef<UpdateStatusResponse | null>(null)
const state = ref<LoadState>('idle')

async function load() {
  state.value = status.value ? state.value : 'loading'

  try {
    status.value = await withErrorMode('silent', () =>
      api.updates.getUpdateStatus())
    state.value = 'ready'
  }
  catch {
    if (!status.value)
      state.value = 'error'
  }
}

/** «Проверить сейчас»: сервер сам не ходит в GitHub чаще раза в минуту */
async function check() {
  status.value = await api.updates.checkForUpdates()
}

async function saveSettings(settings: UpdateSettingsBody) {
  status.value = await api.updates.updateUpdateSettings(settings)
}

/** Карточка на «Обзоре» прячется до следующей версии */
async function dismiss(version: string) {
  await api.updates.dismissUpdate({ version })
}

export function useUpdates() {
  return {
    status: computed(() => status.value),
    state: readonly(state),
    load,
    check,
    saveSettings,
    dismiss,
  }
}
