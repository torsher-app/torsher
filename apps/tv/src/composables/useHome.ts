import type { HomeRow } from '@torsher/api-client'
import type { Ref } from 'vue'
import type { LoadError } from '../lib/loadError.ts'
import { onScopeDispose, ref, shallowRef, watch } from 'vue'
import { api, loadErrorOf } from '../api.ts'
import { createLatest } from '../lib/latest.ts'
import { useCatalogLanguage } from './useCatalogLanguage.ts'

export type HomeMode = 'all' | 'movies' | 'series'

export type HomeStatus = 'loading' | 'ready' | 'error'

/** Ряды главной от сервера; «Фильмы» и «Сериалы» — тот же экран с другим `mode`. */
export function useHome(mode: Ref<HomeMode>) {
  const language = useCatalogLanguage()
  const status = ref<HomeStatus>('loading')
  const rows = shallowRef<HomeRow[]>([])
  const error = ref<LoadError>()
  const latest = createLatest()

  async function load(quiet = false) {
    if (!quiet)
      status.value = 'loading'

    const outcome = await latest.run(signal =>
      api.home.getHome(
        { mode: mode.value, language: language.value },
        { signal },
      ),
    )

    if (outcome.status === 'cancelled')
      return

    if (outcome.status === 'failed') {
      // Тихое перечитывание оставляет прежние ряды
      if (!quiet) {
        error.value = loadErrorOf(outcome.error)
        status.value = 'error'
      }

      return
    }

    rows.value = outcome.value.rows
    status.value = 'ready'
  }

  watch([mode, language], () => load(), { immediate: true })

  onScopeDispose(latest.cancel)

  return {
    status,
    rows,
    error,
    retry: () => load(),
    refresh: () => load(true),
  }
}
