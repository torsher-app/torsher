import type { Card, MineSection } from '@torsher/api-client'
import type { Ref } from 'vue'
import type { LoadError } from '../lib/loadError.ts'
import type { MineView } from '../lib/mineView.ts'
import { onScopeDispose, ref, shallowRef, watch } from 'vue'
import { api, loadErrorOf } from '../api.ts'
import { createLatest } from '../lib/latest.ts'
import { useCatalogLanguage } from './useCatalogLanguage.ts'

export type MineStatus = 'loading' | 'ready' | 'error'

// Страница сервера: больше за раз он не отдаёт
const PAGE_SIZE = 40

/** Разделы «Моё» со счётчиками. `refresh` перечитывает их, не показывая загрузку */
export function useMineSections() {
  const language = useCatalogLanguage()
  const status = ref<MineStatus>('loading')
  const sections = shallowRef<MineSection[]>([])
  const error = ref<LoadError>()
  const latest = createLatest()

  async function load(quiet = false) {
    if (!quiet)
      status.value = 'loading'

    const outcome = await latest.run(signal =>
      api.mine.getMine({ language: language.value }, { signal }),
    )

    if (outcome.status === 'cancelled')
      return

    if (outcome.status === 'failed') {
      if (!quiet) {
        error.value = loadErrorOf(outcome.error)
        status.value = 'error'
      }

      return
    }

    sections.value = outcome.value.sections
    status.value = 'ready'
  }

  watch(language, () => load(), { immediate: true })

  onScopeDispose(latest.cancel)

  return {
    status,
    sections,
    error,
    retry: () => load(),
    refresh: () => load(true),
  }
}

/**
 * Карточки раздела страницами: смена раздела или вида начинает с начала,
 * `more` дочитывает следующую страницу, `refresh` перечитывает загруженное
 * без загрузки на экране.
 */
export function useMineItems(
  section: Ref<MineSection | undefined>,
  view: Ref<MineView>,
) {
  const language = useCatalogLanguage()
  const status = ref<MineStatus>('loading')
  const items = shallowRef<Card[]>([])
  const total = ref(0)
  const error = ref<LoadError>()
  const latest = createLatest()
  let loadingMore = false

  function request(
    current: MineSection,
    offset: number,
    limit: number | undefined,
    signal?: AbortSignal,
  ) {
    return api.mine.getMineItems(
      {
        section: current.id,
        collection: current.collectionId,
        sort: view.value.sort,
        kind: view.value.kind,
        rating: view.value.rating,
        offset,
        limit,
        language: language.value,
      },
      { signal },
    )
  }

  // Ответ страницы, начатой до смены раздела или вида, не ложится в новый список
  let generation = 0

  async function load() {
    const current = section.value

    generation++

    if (!current)
      return

    // Пустой раздел виден по счётчику: сразу пусто, без запроса и скелетона
    if (current.count === 0) {
      latest.cancel()
      items.value = []
      total.value = 0
      status.value = 'ready'

      return
    }

    status.value = 'loading'

    const outcome = await latest.run(signal =>
      request(current, 0, undefined, signal),
    )

    if (outcome.status === 'cancelled')
      return

    if (outcome.status === 'failed') {
      error.value = loadErrorOf(outcome.error)
      status.value = 'error'

      return
    }

    items.value = outcome.value.items
    total.value = outcome.value.total
    status.value = 'ready'
  }

  async function more() {
    const current = section.value
    const started = generation

    if (
      !current
      || loadingMore
      || status.value !== 'ready'
      || items.value.length >= total.value
    ) {
      return
    }

    loadingMore = true

    try {
      const page = await request(current, items.value.length, undefined)

      if (started !== generation)
        return

      items.value = [
        ...items.value,
        ...page.items.filter(
          item => !items.value.some(known => known.id === item.id),
        ),
      ]
      total.value = page.total
    }
    catch {
      // Следующая страница не пришла — дочитаем при следующем подходе к концу
    }
    finally {
      loadingMore = false
    }
  }

  async function refresh() {
    const current = section.value

    if (!current || status.value !== 'ready')
      return

    const outcome = await latest.run(signal =>
      request(
        current,
        0,
        Math.min(Math.max(items.value.length, 1), PAGE_SIZE),
        signal,
      ),
    )

    if (outcome.status === 'done') {
      items.value = outcome.value.items
      total.value = outcome.value.total
    }
  }

  watch(
    () => [
      section.value?.id,
      section.value?.collectionId,
      view.value,
      language.value,
    ],
    load,
    { immediate: true },
  )

  onScopeDispose(latest.cancel)

  return { status, items, total, error, retry: load, more, refresh }
}
