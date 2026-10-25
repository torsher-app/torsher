import type {
  FollowCandidatesResponse,
  FollowDetails,
  FollowSummary,
  UpdateFollowInput,
} from '@torsher/api-client'
import type { FollowGroup } from '~/lib/follow'
import { getErrorStatus } from '@torsher/api-client'
import { useI18n } from 'vue-i18n'
import { FOLLOW_GROUPS, followGroupOf } from '~/lib/follow'
import { api } from '~/services/api'

type LoadState = 'idle' | 'loading' | 'error' | 'ready'

export type FollowsFilter = 'all' | 'attention' | 'stopped'

const FILTERS: FollowsFilter[] = ['all', 'attention', 'stopped']

const follows = shallowRef<FollowSummary[]>([])
const state = ref<LoadState>('idle')
// Карточка: подробности выбранного слежения, перечитываются после действий
const details = shallowRef<FollowDetails | null>(null)
const busy = ref(new Set<string>())

let loadedOnce: Promise<void> | undefined

// Счётчик у раздела в сайдбаре: нет места или серия не нашлась
const attentionCount = computed(
  () =>
    follows.value.filter(follow => followGroupOf(follow) === 'attention')
      .length,
)

/** Язык деталей TMDB: названия и сезоны — на языке панели */
function tmdbLanguage(locale: string) {
  return locale.replace('_', '-')
}

function replaceSummary(updated: FollowSummary) {
  follows.value = follows.value.map(item =>
    item.id === updated.id ? updated : item,
  )
}

function summaryOf({
  episodes: _episodes,
  lastSearchAt: _last,
  nextSearchAt: _next,
  searchRequested: _requested,
  ...summary
}: FollowDetails): FollowSummary {
  return summary
}

function matchesFilter(follow: FollowSummary, filter: FollowsFilter) {
  if (filter === 'all')
    return true

  return followGroupOf(follow) === filter
}

/** Слежения сервера: список, карточка и действия владельца */
export function useFollows() {
  const { locale } = useI18n()
  const language = () => tmdbLanguage(locale.value)

  async function fetchAll() {
    const res = await api.follows.getFollows({ language: language() })

    follows.value = res.items
  }

  async function load() {
    // Показанное остаётся на экране, пока идёт новый запрос, и ошибка его не прячет
    if (state.value !== 'ready')
      state.value = 'loading'

    try {
      await withErrorMode('silent', fetchAll)
      state.value = 'ready'
    }
    catch {
      if (state.value === 'loading')
        state.value = 'error'
    }
  }

  /** Тихо перечитать список: счётчик внимания после ответа в «Активности» */
  function refresh() {
    return withErrorMode('silent', fetchAll).catch(() => {})
  }

  /** Сайдбару и фильтру «Активности» список нужен один раз */
  function ensureLoaded() {
    loadedOnce ??= withErrorMode('silent', fetchAll).catch(() => {
      loadedOnce = undefined
    })

    return loadedOnce
  }

  async function loadDetails(id: string) {
    const loaded = await withErrorMode('silent', () =>
      api.follows.getFollow(id, { language: language() }))

    details.value = loaded
    replaceSummary(summaryOf(loaded))

    return loaded
  }

  async function run<T>(id: string, action: () => Promise<T>) {
    busy.value = new Set(busy.value).add(id)

    try {
      return await action()
    }
    finally {
      const next = new Set(busy.value)

      next.delete(id)
      busy.value = next
    }
  }

  function update(id: string, body: UpdateFollowInput) {
    return run(id, async () => {
      const updated = await withErrorMode('silent', () =>
        api.follows.updateFollow(id, body, { language: language() }))

      details.value = updated
      replaceSummary(summaryOf(updated))

      return updated
    })
  }

  function remove(id: string) {
    return run(id, async () => {
      await withErrorMode('silent', () => api.follows.deleteFollow(id))
      follows.value = follows.value.filter(item => item.id !== id)

      if (details.value?.id === id)
        details.value = null
    })
  }

  function searchNow(id: string) {
    return run(id, async () => {
      await withErrorMode('silent', () => api.follows.postFollowSearch(id))

      if (details.value?.id === id)
        details.value = { ...details.value, searchRequested: true }
    })
  }

  function candidates(
    id: string,
    season: number,
    episode: number,
  ): Promise<FollowCandidatesResponse> {
    return withErrorMode('silent', () =>
      api.follows.getFollowCandidates(id, { season, episode }))
  }

  /** «Не брать эту раздачу»: карточка перечитывается — отложенного могло не стать */
  function block(id: string, candidateId: string) {
    return run(id, async () => {
      await withErrorMode('silent', () =>
        api.follow.postFollowBlocklist({ followId: id, candidateId }))
      await loadDetails(id).catch(() => {})
    })
  }

  return {
    follows,
    state,
    details,
    attentionCount,
    load,
    ensureLoaded,
    refresh,
    loadDetails,
    update,
    remove,
    searchNow,
    candidates,
    block,
    isBusy: (id: string) => busy.value.has(id),
  }
}

/** Поиск на паузе не запускается: слежение остановили, пока карточка была открыта */
export function isNotActive(err: unknown) {
  return getErrorStatus(err) === 409
}

/** Фильтр и поиск списка — в `route.query`, группы по состоянию */
export function useFollowsList() {
  const route = useRoute()
  const router = useRouter()

  function setQuery(patch: Record<string, string | undefined>) {
    router.replace({ query: { ...route.query, ...patch } })
  }

  const filter = computed<FollowsFilter>({
    get: () => {
      const value = route.query.filter

      return FILTERS.includes(value as FollowsFilter)
        ? (value as FollowsFilter)
        : 'all'
    },
    set: value => setQuery({ filter: value === 'all' ? undefined : value }),
  })

  const search = computed({
    get: () => (typeof route.query.q === 'string' ? route.query.q : ''),
    set: value => setQuery({ q: value || undefined }),
  })

  const counts = computed(
    () =>
      Object.fromEntries(
        FILTERS.map(item => [
          item,
          follows.value.filter(follow => matchesFilter(follow, item)).length,
        ]),
      ) as Record<FollowsFilter, number>,
  )

  const groups = computed(() => {
    const needle = search.value.trim().toLowerCase()
    const shown = follows.value.filter(
      follow =>
        matchesFilter(follow, filter.value)
        && (!needle || (follow.title ?? '').toLowerCase().includes(needle)),
    )

    return FOLLOW_GROUPS.map((key: FollowGroup) => ({
      key,
      items: shown.filter(follow => followGroupOf(follow) === key),
    })).filter(group => group.items.length > 0)
  })

  function resetFilters() {
    setQuery({ filter: undefined, q: undefined })
  }

  return { filters: FILTERS, filter, search, counts, groups, resetFilters }
}

/**
 * Название и постер тайтла строки «Активности»: из каталога на языке панели,
 * пока он грузится — из списка слежений; null — показываем скелетон, а не ID
 */
export function useFollowTitle(titleId: () => string | null) {
  const info = useTitleInfo(titleId)

  return computed(() => {
    if (info.value)
      return info.value

    const id = titleId()
    const follow = id
      ? follows.value.find(item => item.titleId === id)
      : undefined

    return follow?.title
      ? { title: follow.title, poster: follow.poster, year: follow.year }
      : null
  })
}
