import type { TitleDetails } from '@torsher/api-client'
import type { Ref } from 'vue'
import type { LoadError } from '../lib/loadError.ts'
import { onScopeDispose, ref, shallowRef, watch } from 'vue'
import { api, loadErrorOf } from '../api.ts'
import { createLatest } from '../lib/latest.ts'
import { useCatalogLanguage } from './useCatalogLanguage.ts'

export type TitleStatus = 'loading' | 'ready' | 'error'

export function useCatalogTitle(id: Ref<string>) {
  const language = useCatalogLanguage()
  const status = ref<TitleStatus>('loading')
  const title = shallowRef<TitleDetails>()
  const error = ref<LoadError>()
  const latest = createLatest()

  async function load() {
    status.value = 'loading'

    // При смене языка старая карточка остаётся на экране до ответа
    if (title.value?.id !== id.value)
      title.value = undefined

    const outcome = await latest.run(signal =>
      api.catalog.getCatalogTitle(
        id.value,
        { language: language.value },
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

    title.value = outcome.value
    status.value = 'ready'
  }

  watch([id, language], load, { immediate: true })

  onScopeDispose(latest.cancel)

  return { status, title, error, retry: load }
}
