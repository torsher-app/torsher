import type { MetadataKeyCheck, MetadataSettings } from '@torsher/api-client'
import { api } from '~/services/api'

type LoadState = 'idle' | 'loading' | 'error' | 'ready'

const settings = shallowRef<MetadataSettings | null>(null)
const state = ref<LoadState>('idle')

async function load() {
  state.value = 'loading'

  try {
    settings.value = await withErrorMode('silent', () =>
      api.settings.getMetadataSettings())
    state.value = 'ready'
  }
  catch {
    state.value = 'error'
  }
}

/** `null` — вернуться к ключу приложения */
async function saveTmdbKey(tmdbKey: string | null) {
  const saved = await api.settings.putMetadataSettings({ tmdbKey })

  settings.value = saved

  return saved
}

/** Без ключа проверяется текущий ключ сервера; неудача — не ошибка запроса */
function checkTmdbKey(tmdbKey?: string): Promise<MetadataKeyCheck> {
  return api.settings.postMetadataCheck({ tmdbKey })
}

export function useMetadataSettings() {
  return {
    settings: computed(() => settings.value),
    state: readonly(state),
    load,
    saveTmdbKey,
    checkTmdbKey,
  }
}
