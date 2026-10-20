import type { Card } from '@torsher/api-client'
import { api } from '../api.ts'
import { useCatalogLanguage } from './useCatalogLanguage.ts'
import { useResource } from './useResource.ts'

/** «Популярно сейчас» для поиска без запроса и пустого результата. */
export function useTrending() {
  const language = useCatalogLanguage()
  const { data, ...rest } = useResource<Card[]>(
    language,
    async (lang, signal) =>
      (await api.catalog.getCatalogTrending({ language: lang }, { signal }))
        .items,
  )

  return { trending: data, ...rest }
}
