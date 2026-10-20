import type { SeasonDetails, TitleExtras } from '@torsher/api-client'
import type { Ref } from 'vue'
import { computed } from 'vue'
import { api } from '../api.ts'
import { createPromiseCache } from '../lib/promiseCache.ts'
import { useCatalogLanguage } from './useCatalogLanguage.ts'
import { useResource } from './useResource.ts'

// Сезоны, по которым прошёл фокус, не запрашиваются повторно за сессию
const SEASON_CACHE_LIMIT = 30

const seasonCache = createPromiseCache<SeasonDetails>(SEASON_CACHE_LIMIT)

/** Серии сезона; `number` пуст у фильма и пока сезон не выбран. */
export function useTitleSeason(
  id: Ref<string>,
  number: Ref<number | undefined>,
) {
  const language = useCatalogLanguage()
  const key = computed(() =>
    number.value === undefined
      ? undefined
      : `${id.value}:${number.value}:${language.value}`,
  )
  const { data, ...rest } = useResource(key, (cacheKey) => {
    const lang = language.value
    const season = String(number.value)

    // Без signal: запрос, начатый пролётом по чипам, долетает и ложится в кэш
    return seasonCache.get(cacheKey, () =>
      api.catalog.getCatalogSeason(id.value, season, { language: lang }))
  })

  return { season: data, ...rest }
}

/** Актёры, похожее и другие названия: грузятся после первого экрана. */
export function useTitleExtras(id: Ref<string | undefined>) {
  const language = useCatalogLanguage()
  const key = computed(() =>
    id.value ? `${id.value}:${language.value}` : undefined,
  )
  const { data, ...rest } = useResource<TitleExtras>(key, (_, signal) =>
    api.catalog.getCatalogTitleExtras(
      id.value!,
      { language: language.value },
      { signal },
    ))

  return { extras: data, ...rest }
}
