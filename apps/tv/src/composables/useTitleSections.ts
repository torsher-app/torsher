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
/** Сезон из клиентского кэша: «Файлы» берут из него названия и кадры серий */
export function loadSeason(id: string, number: number, language: string) {
  return seasonCache.get(`${id}:${number}:${language}`, () =>
    api.catalog.getCatalogSeason(id, String(number), { language }))
}

/** Сезоны тайтла заново с сервера: «Следить» поменяло состояния серий */
export function forgetSeasons(id: string) {
  seasonCache.forget(key => key.startsWith(`${id}:`))
}

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
  // Без signal: запрос, начатый пролётом по чипам, долетает и ложится в кэш
  const { data, ...rest } = useResource(key, () =>
    loadSeason(id.value, number.value!, language.value))

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
