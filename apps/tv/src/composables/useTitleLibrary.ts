import type { TitleLibrary } from '@torsher/api-client'
import type { Ref } from 'vue'
import { computed } from 'vue'
import { api } from '../api.ts'
import { useResource } from './useResource.ts'

/** Файлы тайтла в библиотеке: «Смотреть» играет их сразу, без поиска раздач */
export function useTitleLibrary(id: Ref<string>) {
  const { data, refresh } = useResource<TitleLibrary>(
    computed(() => id.value),
    (key, signal) => api.titles.getTitleLibrary(key, { signal }),
  )

  return {
    libraryFiles: computed(() => data.value?.files ?? []),
    refreshLibrary: refresh,
  }
}
