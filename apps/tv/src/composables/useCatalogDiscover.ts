import type { Card } from '@torsher/api-client'
import type { Ref } from 'vue'
import type { DiscoverParams } from '../lib/catalogFilter.ts'
import type { LoadError } from '../lib/loadError.ts'
import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'
import { api, loadErrorOf } from '../api.ts'
import { createLatest } from '../lib/latest.ts'
import { useCatalogLanguage } from './useCatalogLanguage.ts'

export type CatalogStatus = 'loading' | 'ready' | 'error'

/**
 * Каталог по фильтру с подгрузкой страниц. Новый фильтр отменяет прежний
 * запрос, но прежние карточки остаются, пока не придёт первая страница нового:
 * сетка не мигает пустотой. Сбой следующей страницы — `moreFailed`, а не
 * ошибка экрана.
 */
export function useCatalogDiscover(params: Ref<DiscoverParams>) {
  const language = useCatalogLanguage()
  const key = computed(() => JSON.stringify([params.value, language.value]))
  const status = ref<CatalogStatus>('loading')
  const items = shallowRef<Card[]>([])
  const total = ref(0)
  const error = ref<LoadError>()
  const loadingMore = ref(false)
  const moreFailed = ref(false)
  // Растёт, когда первая страница заменила выдачу: экран встаёт в начало
  const resets = ref(0)
  const latest = createLatest()
  let pages = 0
  let loaded = 0
  // Ответ следующей страницы, пришедший после смены фильтра, не дописывается
  let generation = 0

  function request(page: number, signal?: AbortSignal) {
    return api.catalog.getCatalogDiscover(
      { ...params.value, page, language: language.value },
      { signal },
    )
  }

  async function load() {
    generation += 1
    status.value = 'loading'
    loadingMore.value = false
    moreFailed.value = false

    const outcome = await latest.run(signal => request(1, signal))

    if (outcome.status === 'cancelled')
      return

    if (outcome.status === 'failed') {
      items.value = []
      error.value = loadErrorOf(outcome.error)
      status.value = 'error'

      return
    }

    items.value = outcome.value.items
    total.value = outcome.value.total
    pages = outcome.value.totalPages
    loaded = 1
    status.value = 'ready'
    resets.value += 1
  }

  const hasMore = computed(
    () => status.value === 'ready' && items.value.length > 0 && loaded < pages,
  )

  async function loadMore() {
    if (!hasMore.value || loadingMore.value)
      return

    const current = generation

    loadingMore.value = true
    moreFailed.value = false

    try {
      const page = await request(loaded + 1)

      if (current !== generation)
        return

      // Порядок популярности между страницами плывёт: повторы отбрасываем
      const seen = new Set(items.value.map(item => item.id))

      items.value = [
        ...items.value,
        ...page.items.filter(item => !seen.has(item.id)),
      ]
      loaded += 1
      pages = page.totalPages
    }
    catch {
      if (current === generation)
        moreFailed.value = true
    }
    finally {
      if (current === generation)
        loadingMore.value = false
    }
  }

  watch(key, load, { immediate: true })

  onScopeDispose(latest.cancel)

  return {
    status,
    items,
    total,
    error,
    hasMore,
    loadingMore,
    moreFailed,
    resets,
    retry: load,
    loadMore,
  }
}
