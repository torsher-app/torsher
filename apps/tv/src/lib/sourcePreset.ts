import type { TitleSources } from '@torsher/api-client'
import { reactive } from 'vue'

type Presets = TitleSources['presets']
type StorageAccess = () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const PREFIX = 'torsher.sources.preset.'

/** Storage сам изолирует устройства; ID зрителя разделяет выбор внутри устройства. */
export function createSourcePresetStore(storage: StorageAccess) {
  const values = reactive<Record<string, string | undefined>>({})
  const loaded = new Set<string>()

  function get(profileId: string | undefined) {
    if (!profileId)
      return undefined
    if (!loaded.has(profileId)) {
      loaded.add(profileId)
      try {
        values[profileId] = storage().getItem(PREFIX + profileId) || undefined
      }
      catch {
        // Закрытое storage: ниже сохраняется выбор текущей сессии.
      }
    }
    return values[profileId]
  }

  function set(profileId: string | undefined, presetId: string | undefined) {
    if (!profileId)
      return
    loaded.add(profileId)
    values[profileId] = presetId
    try {
      if (presetId)
        storage().setItem(PREFIX + profileId, presetId)
      else storage().removeItem(PREFIX + profileId)
    }
    catch {
      // Память остаётся источником текущего выбора до закрытия витрины.
    }
  }

  function reconcile(
    profileId: string | undefined,
    requestedId: string | undefined,
    presets: Presets,
  ) {
    // Ответ старого запроса не отменяет более новый выбор зрителя.
    if (
      presets
      && requestedId
      && get(profileId) === requestedId
      && !presets.items.some(item => item.id === requestedId)
    ) {
      set(profileId, undefined)
    }
  }

  return { get, set, reconcile }
}
