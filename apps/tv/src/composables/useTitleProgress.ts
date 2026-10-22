import type { TitleProgress } from '@torsher/api-client'
import type { Ref } from 'vue'
import { computed } from 'vue'
import { api } from '../api.ts'
import { useResource } from './useResource.ts'

/** Прогресс тайтла: последняя начатая серия, раздачи сезонов и серии с отметками */
export function useTitleProgress(id: Ref<string>) {
  const { data, ...rest } = useResource<TitleProgress>(
    computed(() => id.value),
    (titleId, signal) => api.titles.getTitleProgress(titleId, { signal }),
  )

  return { progress: data, ...rest }
}
