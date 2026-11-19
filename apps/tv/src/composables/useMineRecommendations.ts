import type { MineRecommendations } from '@torsher/api-client'
import type { Ref } from 'vue'
import { onScopeDispose, ref, shallowRef, watch } from 'vue'
import { api, loadErrorOf } from '../api.ts'
import { createLatest } from '../lib/latest.ts'
import { isMineViewer, mineViewer } from '../lib/minePersonal.ts'
import { useCatalogLanguage } from './useCatalogLanguage.ts'

type Query = Parameters<typeof api.mine.getMineRecommendations>[0]
export type RecommendationFilters = Required<
  Pick<Query, 'kind' | 'maxMinutes' | 'source'>
>
& Pick<Query, 'genre'>

export const DEFAULT_RECOMMENDATION_FILTERS: RecommendationFilters = {
  kind: 'all',
  maxMinutes: 'any',
  source: 'both',
}

export function useMineRecommendations(active: Ref<boolean>) {
  const language = useCatalogLanguage()
  const storageKey = `torsher.mine.recommendations.${mineViewer()?.expectedProfileId ?? ''}`
  const filters = shallowRef(loadFilters())
  const data = shallowRef<MineRecommendations>()
  const loading = ref(false)
  const error = ref<ReturnType<typeof loadErrorOf>>()
  const latest = createLatest()
  let timer: ReturnType<typeof setTimeout> | undefined

  function loadFilters(): RecommendationFilters {
    try {
      const saved
        = JSON.parse(window.localStorage.getItem(storageKey) ?? '{}') ?? {}
      return {
        kind: ['movie', 'series'].includes(saved.kind) ? saved.kind : 'all',
        maxMinutes: ['90', '120', '150'].includes(saved.maxMinutes)
          ? saved.maxMinutes
          : 'any',
        source: ['watchlist', 'new'].includes(saved.source)
          ? saved.source
          : 'both',
        genre:
          Number.isInteger(saved.genre) && saved.genre > 0
            ? saved.genre
            : undefined,
      }
    }
    catch {
      return { ...DEFAULT_RECOMMENDATION_FILTERS }
    }
  }

  function stop() {
    latest.cancel()
    clearTimeout(timer)
    loading.value = false
  }

  async function read(refresh: 'visible' | 'poll' = 'visible') {
    const context = mineViewer()
    if (!active.value || !context)
      return false
    clearTimeout(timer)
    if (refresh === 'visible') {
      loading.value = true
      error.value = undefined
    }
    const query = filters.value
    const lang = language.value
    const result = await latest.run(signal =>
      api.mine.getMineRecommendations(
        {
          expectedProfileId: context.expectedProfileId,
          language: lang,
          ...query,
          refresh,
        },
        { signal },
      ),
    )

    if (
      !isMineViewer(context)
      || !active.value
      || filters.value !== query
      || lang !== language.value
      || result.status === 'cancelled'
    ) {
      return false
    }
    loading.value = false
    if (result.status === 'failed') {
      error.value = loadErrorOf(result.error)
      return false
    }
    if (result.value.profileId !== context.expectedProfileId)
      return false
    data.value = result.value
    if (result.value.refresh.state === 'pending') {
      timer = setTimeout(() => {
        if (isMineViewer(context) && active.value && filters.value === query)
          void read('poll')
      }, 750)
    }
    return true
  }

  watch(
    active,
    (visible) => {
      if (visible)
        void read()
      else stop()
    },
    { flush: 'sync' },
  )

  watch([filters, language], ([value]) => {
    stop()
    if (data.value)
      data.value = { ...data.value, items: [], refresh: { state: 'idle' } }
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(value))
    }
    catch {
      // Фильтр остаётся выбран в этом экземпляре экрана.
    }
    if (active.value)
      void read()
  })
  onScopeDispose(stop)
  return { filters, data, loading, error, read }
}
