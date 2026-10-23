import type { CatalogTag } from '@torsher/api-client'
import type { Ref } from 'vue'
import type { CatalogType } from '../lib/catalogFilter.ts'
import { computed } from 'vue'
import { api } from '../api.ts'
import { createPromiseCache } from '../lib/promiseCache.ts'
import { useCatalogLanguage } from './useCatalogLanguage.ts'
import { useResource } from './useResource.ts'

// Жанры меняются редко: переключение типа туда и обратно не ходит на сервер
const genres = createPromiseCache<CatalogTag[]>(20)

/** Жанры типа каталога на языке профиля: панель «Жанр» и подпись чипа. */
export function useCatalogGenres(type: Ref<CatalogType>) {
  const language = useCatalogLanguage()
  const key = computed(() => `${type.value}:${language.value}`)
  const { data, ...rest } = useResource<CatalogTag[]>(key, current =>
    genres.get(current, async () => {
      const [kind, lang] = current.split(':') as [CatalogType, string]

      return (
        await api.catalog.getCatalogGenres({ type: kind, language: lang })
      ).items
    }))

  return { genres: data, ...rest }
}
