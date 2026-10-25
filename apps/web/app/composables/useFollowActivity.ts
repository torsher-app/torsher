import type {
  BlocklistItem,
  FollowActivityItem,
  FollowQueueItem,
} from '@torsher/api-client'
import { useDocumentVisibility } from '@vueuse/core'
import { api } from '~/services/api'

type LoadState = 'idle' | 'loading' | 'error' | 'ready'

export type ActivityTab = 'queue' | 'history' | 'blocklist'
export type ActivityKind = FollowActivityItem['kind']

const TABS: ActivityTab[] = ['queue', 'history', 'blocklist']

export const ACTIVITY_KINDS: ActivityKind[] = [
  'found',
  'pending',
  'grabbed',
  'downloaded',
  'upgraded',
  'failed',
  'blocklisted',
  'missing',
  'search',
  'unsure',
  'gap',
]

const PAGE = 50
// Прогресс закачек в очереди живой, но не секундный: раз в 5 с
const QUEUE_POLL_MS = 5000

/** Вкладка и фильтры «Активности» — в `route.query` */
export function useActivityQuery() {
  const route = useRoute()
  const router = useRouter()

  function setQuery(patch: Record<string, string | undefined>) {
    router.replace({ query: { ...route.query, ...patch } })
  }

  const tab = computed<ActivityTab>({
    get: () =>
      TABS.includes(route.query.tab as ActivityTab)
        ? (route.query.tab as ActivityTab)
        : 'queue',
    set: value => setQuery({ tab: value === 'queue' ? undefined : value }),
  })

  const follow = computed({
    get: () =>
      typeof route.query.follow === 'string' ? route.query.follow : '',
    set: value => setQuery({ follow: value || undefined }),
  })

  const kind = computed<ActivityKind | ''>({
    get: () =>
      ACTIVITY_KINDS.includes(route.query.kind as ActivityKind)
        ? (route.query.kind as ActivityKind)
        : '',
    set: value => setQuery({ kind: value || undefined }),
  })

  function resetFilters() {
    setQuery({ follow: undefined, kind: undefined })
  }

  return { tabs: TABS, tab, follow, kind, resetFilters }
}

/** Очередь: вычисляется сервером, перечитывается, пока вкладка открыта */
export function useFollowQueue() {
  const items = shallowRef<FollowQueueItem[]>([])
  const state = ref<LoadState>('idle')
  const visibility = useDocumentVisibility()
  let timer: ReturnType<typeof setTimeout> | undefined
  let active = false

  async function fetchQueue() {
    const res = await withErrorMode('silent', () =>
      api.follow.getFollowQueue())

    items.value = res.items
  }

  function schedule() {
    clearTimeout(timer)

    if (!active)
      return

    timer = setTimeout(async () => {
      if (visibility.value === 'visible') {
        // Сеть моргнула: показанное остаётся, следующий тик попробует снова
        await fetchQueue().catch(() => {})
      }

      schedule()
    }, QUEUE_POLL_MS)
  }

  async function load() {
    // Показанное остаётся на экране, пока идёт новый запрос, и ошибка его не прячет
    if (state.value !== 'ready')
      state.value = 'loading'

    active = true

    try {
      await fetchQueue()
      state.value = 'ready'
    }
    catch {
      if (state.value === 'loading')
        state.value = 'error'
    }

    schedule()
  }

  function stop() {
    active = false
    clearTimeout(timer)
  }

  return { items, state, load, stop }
}

/** История: лента «свежее сверху», порции по курсору `before` */
export function useFollowHistory(filters: {
  follow: Ref<string>
  kind: Ref<ActivityKind | ''>
}) {
  const items = shallowRef<FollowActivityItem[]>([])
  const state = ref<LoadState>('idle')
  const hasMore = ref(false)
  const isLoadingMore = ref(false)
  // Ответ на устаревший фильтр отбрасывается
  let generation = 0

  function query(before?: string) {
    return {
      follow: filters.follow.value || undefined,
      kind: filters.kind.value || undefined,
      before,
      limit: PAGE,
    }
  }

  async function load() {
    const current = ++generation

    state.value = 'loading'

    try {
      const res = await withErrorMode('silent', () =>
        api.follow.getFollowActivity(query()))

      if (current !== generation)
        return

      items.value = res.items
      hasMore.value = res.hasMore
      state.value = 'ready'
    }
    catch {
      if (current === generation)
        state.value = 'error'
    }
  }

  async function loadMore() {
    const last = items.value.at(-1)

    if (!last || isLoadingMore.value)
      return

    const current = generation

    isLoadingMore.value = true

    try {
      const res = await withErrorMode('silent', () =>
        api.follow.getFollowActivity(query(last.id)))

      if (current !== generation)
        return

      const known = new Set(items.value.map(item => item.id))

      items.value = [
        ...items.value,
        ...res.items.filter(item => !known.has(item.id)),
      ]
      hasMore.value = res.hasMore
    }
    finally {
      isLoadingMore.value = false
    }
  }

  const answering = ref<string | null>(null)
  const followsStore = useFollows()

  /** «Это он» или «Не он»: строка обновляется на месте, счётчик внимания — фоном */
  async function answer(id: string, confirm: boolean) {
    answering.value = id

    try {
      await (confirm
        ? api.follow.postFollowUnsureConfirm(id)
        : api.follow.postFollowUnsureDismiss(id))

      const at = new Date().toISOString()

      items.value = items.value.map(item =>
        item.id === id
          ? {
              ...item,
              params: {
                ...item.params,
                [confirm ? 'confirmedAt' : 'dismissedAt']: at,
              },
            }
          : item,
      )
      void followsStore.refresh()
    }
    finally {
      answering.value = null
    }
  }

  return {
    items,
    state,
    hasMore,
    isLoadingMore,
    answering,
    load,
    loadMore,
    answer,
  }
}

/** Чёрный список «Следить»: только действующие записи */
export function useFollowBlocklist() {
  const items = shallowRef<BlocklistItem[]>([])
  const state = ref<LoadState>('idle')
  const removing = ref<string | null>(null)

  // Повторный заход на вкладку перечитывает список тихо: показанное и счётчик
  // на чипе не пропадают на время запроса
  async function load() {
    const shown = state.value === 'ready'

    if (!shown)
      state.value = 'loading'

    try {
      const res = await withErrorMode('silent', () =>
        api.follow.getFollowBlocklist())

      items.value = res.items
      state.value = 'ready'
    }
    catch {
      if (!shown)
        state.value = 'error'
    }
  }

  async function remove(id: string) {
    removing.value = id

    try {
      await api.follow.deleteFollowBlocklist(id)
      items.value = items.value.filter(item => item.id !== id)
    }
    finally {
      removing.value = null
    }
  }

  return { items, state, removing, load, remove }
}
