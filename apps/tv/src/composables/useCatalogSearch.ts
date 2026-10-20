import type { Card } from '@torsher/api-client'
import type { Ref } from 'vue'
import type { LoadError } from '../lib/loadError.ts'
import { onScopeDispose, ref, shallowRef, watch } from 'vue'
import { api, loadErrorOf } from '../api.ts'
import { createLatest } from '../lib/latest.ts'
import { useCatalogLanguage } from './useCatalogLanguage.ts'

// Запрос уходит, когда пользователь перестал печатать, а не на каждую букву
const DEBOUNCE_MS = 300

export type SearchStatus = 'idle' | 'loading' | 'ready' | 'error'

/** Пока идёт новый запрос, прежние результаты остаются на экране. */
export function useCatalogSearch(query: Ref<string>) {
  const language = useCatalogLanguage()
  const status = ref<SearchStatus>('idle')
  const items = shallowRef<Card[]>([])
  const error = ref<LoadError>()
  const latest = createLatest()
  let timer: ReturnType<typeof setTimeout> | undefined

  async function search() {
    clearTimeout(timer)

    const text = query.value.trim()

    if (!text) {
      latest.cancel()
      status.value = 'idle'
      items.value = []

      return
    }

    status.value = 'loading'

    const outcome = await latest.run(signal =>
      api.catalog.getCatalogSearch(
        { query: text, language: language.value },
        { signal },
      ),
    )

    if (outcome.status === 'cancelled')
      return

    if (outcome.status === 'failed') {
      error.value = loadErrorOf(outcome.error)
      status.value = 'error'

      return
    }

    items.value = outcome.value.items
    status.value = 'ready'
  }

  watch([query, language], () => {
    clearTimeout(timer)

    if (!query.value.trim()) {
      search()

      return
    }

    status.value = 'loading'
    timer = setTimeout(search, DEBOUNCE_MS)
  })

  onScopeDispose(() => {
    clearTimeout(timer)
    latest.cancel()
  })

  return { status, items, error, retry: search }
}
