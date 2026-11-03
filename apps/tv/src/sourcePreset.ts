import { computed } from 'vue'
import { createSourcePresetStore } from './lib/sourcePreset.ts'
import { session } from './session.ts'

export const sourcePresetStore = createSourcePresetStore(
  () => window.localStorage,
)
export const selectedSourcePreset = computed(() =>
  sourcePresetStore.get(session.profile?.id),
)

export function selectSourcePreset(id: string | undefined) {
  sourcePresetStore.set(session.profile?.id, id)
}
