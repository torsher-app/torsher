import type {
  StorageOverview,
  UpdateStoragePolicyInput,
} from '@torsher/api-client'
import { api } from '~/services/api'

type LoadState = 'idle' | 'loading' | 'error' | 'ready'

const overview = shallowRef<StorageOverview | null>(null)
const state = ref<LoadState>('idle')

async function load() {
  state.value = 'loading'

  try {
    overview.value = await withErrorMode('silent', () =>
      api.storage.getStorage())
    state.value = 'ready'
  }
  catch {
    state.value = 'error'
  }
}

/** Сохраняет политику целиком: карточка меняет одно поле, второе — как сейчас */
async function savePolicy(patch: Partial<UpdateStoragePolicyInput>) {
  const current = overview.value?.policy

  if (!current)
    return

  overview.value = await api.storage.putStoragePolicy({
    cacheLimit: patch.cacheLimit ?? current.cacheLimit,
    minFree: patch.minFree ?? current.minFree,
  })
}

export function useStorage() {
  return {
    overview: computed(() => overview.value),
    state: readonly(state),
    load,
    savePolicy,
  }
}
