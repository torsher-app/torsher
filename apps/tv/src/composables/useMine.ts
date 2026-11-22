import type {
  Card,
  ContinueCard,
  MineBootstrap,
  MineSectionCounts,
  ScheduleResponse,
} from '@torsher/api-client'
import type { Ref } from 'vue'
import type { LoadError } from '../lib/loadError.ts'
import type {
  ContinueState,
  MineMenuSection,
  WatchedScope,
} from '../lib/minePersonal.ts'
import {
  mineViewer,
  personalCard,
  personalContinueCard,
} from '../lib/minePersonal.ts'
import type { MineView } from '../lib/mineView.ts'
import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'
import { captureTitleViewer, isTitleViewer } from '../titleActions.ts'
import { api, loadErrorOf } from '../api.ts'
import { createLatest } from '../lib/latest.ts'
import { useCatalogLanguage } from './useCatalogLanguage.ts'
import { useResource } from './useResource.ts'

export type MineStatus = 'loading' | 'ready' | 'error'

// Страница сервера: больше за раз он не отдаёт
const PAGE_SIZE = 40

/** Меню и старт читаются из локальных данных профиля. */
export function useMineBootstrap() {
  const status = ref<MineStatus>('loading')
  const bootstrap = shallowRef<MineBootstrap>()
  const error = ref<LoadError>()
  const latest = createLatest()

  async function load(quiet = false) {
    const context = mineViewer()
    if (!context)
      return false
    if (!quiet)
      status.value = 'loading'
    const outcome = await latest.run(signal =>
      api.mine.getMineBootstrap(
        { expectedProfileId: context.expectedProfileId },
        { signal },
      ),
    )
    if (!isTitleViewer(context.viewer) || outcome.status === 'cancelled')
      return false
    if (outcome.status === 'failed') {
      if (!quiet) {
        error.value = loadErrorOf(outcome.error)
        status.value = 'error'
      }
      return false
    }
    if (outcome.value.profileId !== context.expectedProfileId)
      return false
    bootstrap.value = outcome.value
    status.value = 'ready'
    return true
  }

  void load()
  onScopeDispose(latest.cancel)

  return {
    status,
    bootstrap,
    error,
    retry: () => load(),
    refresh: () => load(true),
  }
}

export function useMineSectionCounts() {
  const language = useCatalogLanguage()
  const context = mineViewer()
  const { data, status, retry, refresh } = useResource(
    computed(() => context && language.value),
    async (language, signal): Promise<MineSectionCounts | undefined> => {
      if (!context)
        return
      const counts = await api.mine.getMineSectionCounts(
        { language, expectedProfileId: context.expectedProfileId },
        { signal },
      )
      if (counts.profileId === context.expectedProfileId)
        return counts
    },
  )
  return {
    counts: data,
    status,
    refresh: () => (status.value === 'ready' ? refresh() : retry()),
  }
}

export interface MineGridItem {
  card: Card
  continuation?: ContinueCard
  cycle?: import('@torsher/api-client').MineCycle | null
  continuationState?: ContinueState
  canResume?: boolean
}

/**
 * Карточки раздела страницами: смена раздела или вида начинает с начала,
 * `more` дочитывает следующую страницу, `refresh` перечитывает загруженное
 * без загрузки на экране.
 */
export function useMineItems(
  section: Ref<MineMenuSection | undefined>,
  view: Ref<MineView>,
  options?: {
    state: Ref<ContinueState>
    watched: Ref<WatchedScope | undefined>
  },
) {
  const language = useCatalogLanguage()
  const status = ref<MineStatus>('loading')
  const items = shallowRef<MineGridItem[]>([])
  const total = ref(0)
  const error = ref<LoadError>()
  const latest = createLatest()
  let loadingMore: number | undefined
  let refreshing = false

  async function request(
    current: MineMenuSection,
    offset: number,
    limit: number | undefined,
    signal?: AbortSignal,
  ): Promise<{ items: MineGridItem[], total: number }> {
    const context = mineViewer()
    const query = { ...view.value, offset, limit, language: language.value }
    if (context && current.id === 'continue') {
      const result = await api.mine.getMinePersonalContinue(
        {
          ...query,
          expectedProfileId: context.expectedProfileId,
          state: options?.state.value,
        },
        { signal },
      )
      return {
        items: result.items.map((row) => {
          const continuation = personalContinueCard(row)
          return {
            card: continuation,
            continuation,
            cycle: row.cycle,
            continuationState: row.continuation,
            canResume:
              row.cycle?.state === 'active'
                ? !!row.cycle.resume
                : !!row.normalResume,
          }
        }),
        total: result.total,
      }
    }
    if (context && current.id === 'watched') {
      const scope = options?.watched.value
      const result = await api.mine.getMinePersonalWatched(
        {
          ...query,
          expectedProfileId: context.expectedProfileId,
          source: scope?.source,
          genre: scope?.genre,
          country: scope?.country,
        },
        { signal },
      )
      return {
        items: result.items.map(row => ({
          card: personalCard(
            row.titleId,
            row.kind,
            row.metadata,
            row.ownRating,
          ),
        })),
        total: result.total,
      }
    }
    const result = await api.mine.getMineItems(
      {
        ...query,
        section: current.id,
        collection: current.collectionId,
      },
      { signal },
    )
    return {
      items: result.items.map(card => ({ card })),
      total: result.total,
    }
  }

  // Ответ страницы, начатой до смены раздела или вида, не ложится в новый список
  let generation = 0

  async function load() {
    const current = section.value

    const started = ++generation
    loadingMore = undefined
    refreshing = false
    const viewer = captureTitleViewer()

    if (!current)
      return

    status.value = 'loading'

    const outcome = await latest.run(signal =>
      request(current, 0, undefined, signal),
    )

    if (
      started !== generation
      || !isTitleViewer(viewer)
      || outcome.status === 'cancelled'
    ) {
      return
    }

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
      || loadingMore !== undefined
      || refreshing
      || status.value !== 'ready'
      || items.value.length >= total.value
    ) {
      return
    }

    loadingMore = started
    const viewer = captureTitleViewer()

    try {
      const page = await request(current, items.value.length, undefined)

      if (started !== generation || !isTitleViewer(viewer))
        return

      items.value = [
        ...items.value,
        ...page.items.filter(
          item =>
            !items.value.some(known => known.card.id === item.card.id),
        ),
      ]
      total.value = page.total
    }
    catch {
      // Следующая страница не пришла — дочитаем при следующем подходе к концу
    }
    finally {
      if (loadingMore === started)
        loadingMore = undefined
    }
  }

  async function refresh() {
    const current = section.value

    if (!current || status.value !== 'ready')
      return !current

    const started = ++generation
    loadingMore = undefined
    refreshing = true
    const viewer = captureTitleViewer()
    const outcome = await latest.run(signal =>
      request(
        current,
        0,
        Math.min(Math.max(items.value.length, 1), PAGE_SIZE),
        signal,
      ),
    )

    if (started === generation)
      refreshing = false
    if (
      started === generation
      && isTitleViewer(viewer)
      && outcome.status === 'done'
    ) {
      items.value = outcome.value.items
      total.value = outcome.value.total
      return true
    }
    return false
  }

  const sources = [
    () => section.value?.id,
    () => section.value?.collectionId,
    view,
    language,
    () => (section.value?.id === 'continue' ? options?.state.value : undefined),
    () =>
      section.value?.id === 'watched' ? options?.watched.value : undefined,
  ]
  // Устаревший ответ теряет право на запись сразу; смена раздела и его вида
  // в одном tick при этом отправляет только один запрос с конечными параметрами.
  watch(
    sources,
    () => {
      generation++
      latest.cancel()
      loadingMore = undefined
      refreshing = false
    },
    { flush: 'sync' },
  )
  watch(sources, load, { immediate: true })

  onScopeDispose(() => {
    generation++
    latest.cancel()
  })

  const refreshReady = computed(
    () => !section.value || status.value !== 'loading',
  )
  return {
    status,
    items,
    total,
    error,
    retry: load,
    more,
    refresh,
    refreshReady,
  }
}

/** Расписание загружается вместе с «Моё» для счётчика в меню. */
export function useSchedule() {
  const language = useCatalogLanguage()
  const { data, status, error, retry, refresh } = useResource<ScheduleResponse>(
    language,
    (current, signal) =>
      api.schedule.getSchedule({ language: current }, { signal }),
  )

  return {
    schedule: data,
    status,
    error,
    retry,
    refresh: () => (status.value === 'ready' ? refresh() : retry()),
  }
}
