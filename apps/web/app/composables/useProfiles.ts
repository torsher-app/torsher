import type {
  CreateProfileInput,
  Profile,
  UpdateProfileInput,
} from '@torsher/api-client'
import { api } from '~/services/api'

type LoadState = 'idle' | 'loading' | 'error' | 'ready'

const profiles = shallowRef<Profile[]>([])
const state = ref<LoadState>('idle')

function replaceProfile(updated: Profile) {
  profiles.value = profiles.value.map(item =>
    item.id === updated.id ? updated : item,
  )
}

async function load() {
  state.value = 'loading'

  try {
    const res = await withErrorMode('silent', () => api.profiles.getProfiles())

    profiles.value = res.items
    state.value = 'ready'
  }
  catch {
    state.value = 'error'
  }
}

/** Профили смотрящих; первый по порядку — профиль по умолчанию */
export function useProfiles() {
  const defaultId = computed(() => profiles.value[0]?.id ?? null)

  async function create(body: CreateProfileInput) {
    const created = await api.profiles.postProfile(body)

    profiles.value = [...profiles.value, created]

    return created
  }

  async function update(id: string, body: UpdateProfileInput) {
    const updated = await api.profiles.patchProfile(id, body)

    replaceProfile(updated)

    return updated
  }

  async function setPin(id: string, pin: string) {
    replaceProfile(await api.profiles.putProfilePin(id, { pin }))
  }

  async function clearPin(id: string) {
    replaceProfile(await api.profiles.deleteProfilePin(id))
  }

  /** `moveTo` — профиль, в который уходит история просмотра; без него она удаляется */
  async function remove(id: string, moveTo?: string) {
    await api.profiles.deleteProfile(id, moveTo ? { moveTo } : {})
    profiles.value = profiles.value.filter(item => item.id !== id)
  }

  return {
    profiles,
    state,
    defaultId,
    load,
    create,
    update,
    setPin,
    clearPin,
    remove,
  }
}
