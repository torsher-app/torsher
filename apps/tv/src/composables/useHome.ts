import type { ContinueRow, HomeRow } from '@torsher/api-client'
import type { Ref } from 'vue'
import type { LoadError } from '../lib/loadError.ts'
import { onScopeDispose, ref, shallowRef, watch } from 'vue'
import { api, loadErrorOf } from '../api.ts'
import { replaceContinueRow } from '../lib/continue.ts'
import { createLatest } from '../lib/latest.ts'
import { useCatalogLanguage } from './useCatalogLanguage.ts'

export type HomeMode = 'all' | 'movies' | 'series' | 'library'

export type HomeStatus = 'loading' | 'ready' | 'error'

/** Ряды главной от сервера; «Фильмы» и «Сериалы» — тот же экран с другим `mode`. */
export function useHome(mode: Ref<HomeMode>) {
  const language = useCatalogLanguage()
  const status = ref<HomeStatus>('loading')
  const rows = shallowRef<HomeRow[]>([])
  const error = ref<LoadError>()
  // Загрузок с лоадером: по нему экран отличает новую главную от тихого
  // обновления рядов (правка списков, «Продолжить» после плеера)
  const loads = ref(0)
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

    // Тихое перечитывание — обновление тех же рядов, а не новая главная
    if (!quiet)
      loads.value++
  }

  /**
   * «Продолжить» после возврата из плеера: только этот ряд, без лоадера и без
   * перезагрузки рядов каталога. Ошибка оставляет прежний ряд.
   */
  async function refreshContinue() {
    if (status.value !== 'ready')
      return

    let row: ContinueRow

    try {
      row = await api.home.getHomeContinue({
        mode: mode.value,
        language: language.value,
      })
    }
    catch {
      return
    }

    // Пока шёл запрос, главная могла начать грузиться заново
    if (status.value === 'ready')
      rows.value = replaceContinueRow(rows.value, row)
  }

  watch([mode, language], () => load(), { immediate: true })

  onScopeDispose(latest.cancel)

  return {
    status,
    rows,
    loads,
    error,
    retry: () => load(),
    refresh: () => load(true),
    refreshContinue,
  }
}
