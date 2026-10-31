import type { NotificationItem } from '@torsher/api-client'
import type { FeedGroup } from '~/lib/notifications'
import { useDocumentVisibility } from '@vueuse/core'
import {
  computed,
  onBeforeUnmount,
  onMounted,
  onScopeDispose,
  readonly,
  ref,
  shallowRef,
  watch,
} from 'vue'
import { FEED_GROUPS } from '~/lib/notifications'
import { api } from '~/services/api'

type LoadState = 'idle' | 'loading' | 'error' | 'ready'

interface FeedFilter {
  group?: FeedGroup
  unread?: boolean
}

// Колокол на каждой странице: опрос редкий и только в видимой вкладке
const UNREAD_POLL_MS = 30_000
export const BELL_SIZE = 20
const PAGE_SIZE = 50

const unread = ref(0)
// Ленты колокола и страницы: отметка «прочитано» видна в обеих сразу
const feeds = new Set<NotificationFeed>()

let pollTimer: ReturnType<typeof setTimeout> | undefined
let bells = 0
let pollGeneration = 0

// Чтение и фоновые GET не должны возвращать состояние до отметки прочитанного.
let readQueue = Promise.resolve()
const reading = new Map<string, Promise<void>>()

async function readConsistently<T>(request: () => Promise<T>): Promise<T> {
  for (;;) {
    const pending = readQueue

    await pending.catch(() => {})
    const result = await request()

    if (pending === readQueue)
      return result
  }
}

function enqueueRead(action: () => Promise<void>) {
  const pending = readQueue.catch(() => {}).then(action)

  readQueue = pending

  return pending
}

type NotificationFeed = ReturnType<typeof createFeed>

function createFeed(pageSize: number, filter: () => FeedFilter = () => ({})) {
  const items = shallowRef<NotificationItem[]>([])
  const nextCursor = ref<string>()
  const state = ref<LoadState>('idle')
  const isLoadingMore = ref(false)
  // Ответ на устаревший фильтр отбрасывается
  let generation = 0

  function query(before?: string) {
    const { group, unread: onlyUnread } = filter()

    return {
      limit: pageSize,
      before,
      group,
      unread: onlyUnread ? ('1' as const) : undefined,
    }
  }

  /**
   * Первая страница заново. Прошлый список виден до ответа; `reset` — он
   * не подходит к новому фильтру, и на его месте скелетон.
   */
  async function load(options: { reset?: boolean } = {}) {
    const current = ++generation

    if (options.reset || state.value !== 'ready')
      state.value = 'loading'

    try {
      const page = await readConsistently(() =>
        withErrorMode('silent', () =>
          api.notifications.getNotifications(query())),
      )

      if (current !== generation)
        return

      items.value = page.items
      nextCursor.value = page.nextCursor
      unread.value = page.unread
      state.value = 'ready'
    }
    catch {
      if (current === generation && state.value === 'loading')
        state.value = 'error'
    }
  }

  async function loadMore() {
    if (!nextCursor.value || isLoadingMore.value)
      return

    const current = generation

    isLoadingMore.value = true

    try {
      const page = await readConsistently(() =>
        withErrorMode('silent', () =>
          api.notifications.getNotifications(query(nextCursor.value))),
      )

      if (current !== generation)
        return

      const known = new Set(items.value.map(item => item.id))

      items.value = [
        ...items.value,
        ...page.items.filter(item => !known.has(item.id)),
      ]
      nextCursor.value = page.nextCursor
      unread.value = page.unread
    }
    finally {
      isLoadingMore.value = false
    }
  }

  function markLocally(ids: Set<string> | 'all', at: string) {
    items.value = items.value.map(item =>
      !item.readAt && (ids === 'all' || ids.has(item.id))
        ? { ...item, readAt: at }
        : item,
    )
  }

  function dispose() {
    generation += 1
  }

  function isUnread(id: string) {
    return items.value.some(item => item.id === id && !item.readAt)
  }

  return {
    items: computed(() => items.value),
    hasMore: computed(() => Boolean(nextCursor.value)),
    state: readonly(state),
    isLoadingMore: readonly(isLoadingMore),
    load,
    loadMore,
    markLocally,
    isUnread,
    dispose,
  }
}

const bellFeed = createFeed(BELL_SIZE)

feeds.add(bellFeed)

async function refreshUnread() {
  try {
    const result = await readConsistently(() =>
      withErrorMode('silent', () => api.notifications.getUnreadNotifications()),
    )

    unread.value = result.count
  }
  catch {}
}

function markRead(id: string) {
  const existing = reading.get(id)

  if (existing)
    return existing

  // Переход по ссылке размонтирует страницу раньше выполнения очереди.
  if (![...feeds].some(feed => feed.isUnread(id)))
    return Promise.resolve()

  const pending = enqueueRead(async () => {
    await api.notifications.markNotificationsRead({ ids: [id] })
    const at = new Date().toISOString()

    for (const feed of feeds) feed.markLocally(new Set([id]), at)

    unread.value = Math.max(0, unread.value - 1)
  })

  reading.set(id, pending)
  const clear = () => {
    reading.delete(id)
  }

  void pending.then(clear, clear)

  return pending
}

function markAllRead() {
  return enqueueRead(async () => {
    await api.notifications.markNotificationsRead({ all: true })
    const at = new Date().toISOString()

    for (const feed of feeds) feed.markLocally('all', at)

    unread.value = 0
  })
}

function stopPolling() {
  pollGeneration += 1
  clearTimeout(pollTimer)
  pollTimer = undefined
}

function startPolling() {
  stopPolling()
  const current = pollGeneration

  const tick = async () => {
    await refreshUnread()
    if (current === pollGeneration)
      pollTimer = setTimeout(tick, UNREAD_POLL_MS)
  }

  void tick()
}

/** Колокол: последние уведомления без дочитывания, вся лента — на странице */
export function useNotifications() {
  return {
    unread: readonly(unread),
    items: bellFeed.items,
    hasMore: bellFeed.hasMore,
    state: bellFeed.state,
    load: () => bellFeed.load(),
    markRead,
    markAllRead,
  }
}

/** Фильтр страницы «Уведомления» в `route.query`; умолчания в адрес не пишутся */
export function useNotificationsQuery() {
  const route = useRoute()
  const router = useRouter()

  function setQuery(patch: Record<string, string | undefined>) {
    router.replace({ query: { ...route.query, ...patch } })
  }

  const group = computed<FeedGroup | undefined>({
    get: () =>
      FEED_GROUPS.includes(route.query.group as FeedGroup)
        ? (route.query.group as FeedGroup)
        : undefined,
    set: value => setQuery({ group: value }),
  })

  const unreadOnly = computed({
    get: () => route.query.unread === '1',
    set: value => setQuery({ unread: value ? '1' : undefined }),
  })

  function resetFilters() {
    setQuery({ group: undefined, unread: undefined })
  }

  return { group, unreadOnly, resetFilters }
}

/** Лента страницы: своя на каждое открытие, живёт, пока смонтирована */
export function useNotificationFeed(filter: () => FeedFilter) {
  const feed = createFeed(PAGE_SIZE, filter)

  feeds.add(feed)
  onScopeDispose(() => {
    feed.dispose()
    feeds.delete(feed)
  })

  return {
    unread: readonly(unread),
    items: feed.items,
    hasMore: feed.hasMore,
    state: feed.state,
    isLoadingMore: feed.isLoadingMore,
    load: feed.load,
    loadMore: feed.loadMore,
    markRead,
    markAllRead,
  }
}

/**
 * Счётчик колокола. Колокол стоит в шапке каждой страницы, поэтому опрос
 * один на панель: идёт, пока смонтирован хотя бы один колокол.
 */
export function useUnreadPolling() {
  const visibility = useDocumentVisibility()
  let mounted = false

  function sync() {
    if (bells > 0 && visibility.value === 'visible')
      startPolling()
    else stopPolling()
  }

  onMounted(() => {
    mounted = true
    bells += 1

    if (bells === 1)
      sync()
  })

  watch(visibility, () => {
    if (mounted)
      sync()
  })

  onBeforeUnmount(() => {
    mounted = false
    bells -= 1

    if (bells === 0)
      stopPolling()
  })
}
