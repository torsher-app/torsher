import type { TitleProgress } from '@torsher/api-client'
import type { Ref } from 'vue'
import { computed } from 'vue'
import { api } from '../api.ts'
import { useCatalogLanguage } from './useCatalogLanguage.ts'
import { useResource } from './useResource.ts'

/**
 * Прогресс тайтла: что продолжать, последняя начатая серия, раздачи сезонов и
 * серии с отметками. Язык — тот же, что у деталей карточки: следующую серию
 * сервер ищет по ним, и кэш TMDB общий.
 */
export function useTitleProgress(id: Ref<string>) {
  const language = useCatalogLanguage()
  const { data, ...rest } = useResource<TitleProgress>(
    computed(() => `${id.value}|${language.value}`),
    (_, signal) =>
      api.titles.getTitleProgress(
        id.value,
        { language: language.value },
        { signal },
      ),
  )

  return { progress: data, ...rest }
}
