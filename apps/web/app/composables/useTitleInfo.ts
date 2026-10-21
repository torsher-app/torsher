import type { TitleDetails } from '@torsher/api-client'
import { useI18n } from 'vue-i18n'
import { api } from '~/services/api'

type TitleInfo = Pick<TitleDetails, 'title' | 'poster' | 'year'>

// Один запрос на тайтл за сессию: строки опрашиваются каждые 2 с
const cache = new Map<string, Ref<TitleInfo | null>>()

/** Название и постер тайтла каталога, к которому привязана раздача */
export function useTitleInfo(titleId: () => string | null) {
  const { locale } = useI18n()

  return computed(() => {
    const id = titleId()

    if (!id)
      return null

    const key = `${id}:${locale.value}`
    let entry = cache.get(key)

    if (!entry) {
      const info = ref<TitleInfo | null>(null)

      entry = info
      cache.set(key, info)
      withErrorMode('silent', () =>
        api.catalog.getCatalogTitle(id, {
          language: locale.value.replace('_', '-'),
        }))
        .then((details) => {
          info.value = {
            title: details.title,
            poster: details.poster,
            year: details.year,
          }
        })
        // Без каталога строка показывает имя раздачи
        .catch(() => {})
    }

    return entry.value
  })
}
