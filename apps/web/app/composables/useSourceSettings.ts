import type {
  SourceSettings,
  UpdateSourcePresetInput,
} from '@torsher/api-client'
import { api } from '~/services/api'

const settings = shallowRef<SourceSettings | null>(null)
const state = ref<'idle' | 'loading' | 'error' | 'ready'>('idle')

export function useSourceSettings() {
  async function load() {
    if (state.value !== 'ready')
      state.value = 'loading'
    try {
      settings.value = await withErrorMode('silent', () =>
        api.settings.getSourceSettings())
      state.value = 'ready'
    }
    catch {
      if (state.value === 'loading')
        state.value = 'error'
    }
  }

  async function save(id: string, body: UpdateSourcePresetInput) {
    settings.value = await api.settings.patchSourcePreset(id, body)
    return settings.value
  }
  async function create(name: string) {
    settings.value = await api.settings.postSourcePreset({ name })
    return settings.value
  }
  async function remove(id: string) {
    settings.value = await api.settings.deleteSourcePreset(id)
    return settings.value
  }
  async function makeDefault(id: string) {
    settings.value = await api.settings.putSourceSettings({
      defaultPresetId: id,
    })
    return settings.value
  }
  return { settings, state, load, save, create, remove, makeDefault }
}
