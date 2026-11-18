import {
  diagnostic,
  diagnosticAction,
  diagnosticParams,
} from '../diagnostics/index.ts'
import { noteContinueReceived } from '../diagnostics/continue.ts'
import type { HomeResponse, HomeRow } from '@torsher/api-client'
import type { Ref } from 'vue'
import type { LoadError } from '../lib/loadError.ts'
import { onScopeDispose, ref, shallowRef, watch } from 'vue'
import { captureTitleViewer, isTitleViewer } from '../titleActions.ts'
import { api, loadErrorOf } from '../api.ts'
import { replaceContinueRow } from '../lib/continue.ts'
import { createLatest } from '../lib/latest.ts'
import { noteHasSources } from '../serverSources.ts'
import { useCatalogLanguage } from './useCatalogLanguage.ts'

export type HomeMode = 'all' | 'movies' | 'series' | 'library'

export type HomeStatus = 'loading' | 'ready' | 'error'

/** Ряды главной от сервера; «Фильмы» и «Сериалы» — тот же экран с другим `mode`. */
export function useHome(mode: Ref<HomeMode>) {
  const language = useCatalogLanguage()
  const status = ref<HomeStatus>('loading')
  const rows = shallowRef<HomeRow[]>([])
  const error = ref<LoadError>()
  const catalogError = ref<HomeResponse['catalogError']>()
  // Загрузок с лоадером: по нему экран отличает новую главную от тихого
  // обновления рядов (правка списков, «Продолжить» после плеера)
  const loads = ref(0)
  const latest = createLatest()
  const partial = createLatest()
  const refreshing = ref(false)
  let fullRun = 0

  async function load(quiet = false) {
    partial.cancel()
    const run = ++fullRun
    const viewer = captureTitleViewer()
    const currentMode = mode.value
    const currentLanguage = language.value
    refreshing.value = true
    if (!quiet)
      status.value = 'loading'

    const outcome = await latest.run(signal =>
      api.home.getHome(
        { mode: currentMode, language: currentLanguage },
        { signal },
      ),
    )

    if (run === fullRun)
      refreshing.value = false

    if (
      !isTitleViewer(viewer)
      || mode.value !== currentMode
      || language.value !== currentLanguage
      || outcome.status === 'cancelled'
    ) {
      return false
    }

    if (outcome.status === 'failed') {
      // Тихое перечитывание оставляет прежние ряды
      if (!quiet) {
        error.value = loadErrorOf(outcome.error)
        status.value = 'error'
      }

      return false
    }

    noteHasSources(outcome.value.hasSources)
    for (const row of outcome.value.rows) {
      if (row.kind === 'continue')
        noteContinueReceived(row.items)
    }
    catalogError.value = outcome.value.catalogError
    rows.value = outcome.value.rows
    status.value = 'ready'

    // Тихое перечитывание — обновление тех же рядов, а не новая главная
    if (!quiet)
      loads.value++
    return true
  }

  /**
   * «Продолжить» после возврата из плеера: только этот ряд, без лоадера и без
   * перезагрузки рядов каталога. Ошибка оставляет прежний ряд.
   */
  async function refreshContinue() {
    if (status.value !== 'ready' || refreshing.value)
      return

    const context = diagnosticAction()
    const viewer = captureTitleViewer()
    const currentMode = mode.value
    const currentLanguage = language.value
    const outcome = await partial.run(signal =>
      api.home.getHomeContinue(
        { mode: currentMode, language: currentLanguage },
        { ...diagnosticParams(context), signal },
      ),
    )
    if (outcome.status === 'cancelled')
      return
    if (outcome.status === 'failed') {
      diagnostic(
        { event: 'continue.refresh', outcome: 'failed', retained: true },
        context,
      )
      return
    }

    if (
      isTitleViewer(viewer)
      && !refreshing.value
      && mode.value === currentMode
      && language.value === currentLanguage
      && status.value === 'ready'
    ) {
      noteContinueReceived(outcome.value.items)
      rows.value = replaceContinueRow(rows.value, outcome.value)
      diagnostic(
        { event: 'continue.refresh', outcome: 'accepted', retained: false },
        context,
      )
    }
    else {
      diagnostic(
        { event: 'continue.refresh', outcome: 'stale', retained: true },
        context,
      )
    }
  }

  watch([mode, language], () => load(), { immediate: true })

  onScopeDispose(() => {
    latest.cancel()
    partial.cancel()
  })

  return {
    status,
    refreshing,
    rows,
    loads,
    error,
    catalogError,
    retry: () => load(),
    refresh: () => load(true),
    refreshContinue,
  }
}
