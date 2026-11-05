import type { TitleSeason } from '@torsher/api-client'
import type { Ref } from 'vue'
import type { ResourceStatus } from './useResource.ts'
import { watch } from 'vue'
import { initialSeason } from '../lib/episodeActions.ts'

/** Однократная инициализация экземпляра карточки, без сброса при KeepAlive. */
export function useInitialSeason(
  seasons: Ref<Pick<TitleSeason, 'number'>[]>,
  progressStatus: Ref<ResourceStatus>,
  resumeSeason: () => number | null | undefined,
  apply: (season: number) => void,
) {
  let initialized = false
  watch(
    [seasons, progressStatus],
    ([list, status]) => {
      if (
        initialized
        || status === 'loading'
        || status === 'idle'
        || !list.length
      ) {
        return
      }
      initialized = true
      apply(initialSeason(list, resumeSeason())!)
    },
    { immediate: true },
  )

  return {
    // Даже явный выбор уже выбранного номера сильнее позднего прогресса.
    manual: () => {
      initialized = true
    },
  }
}
