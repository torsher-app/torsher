import type { NotificationItem } from '@torsher/api-client'
import { useDocumentVisibility } from '@vueuse/core'
import { api } from '~/services/api'

type LoadState = 'idle' | 'loading' | 'error' | 'ready'

// Колокол на каждой странице: опрос редкий и только в видимой вкладке
const UNREAD_POLL_MS = 30_000
const PAGE_SIZE = 20

const unread = ref(0)
const items = shallowRef<NotificationItem[]>([])
const nextCursor = ref<string>()
const state = ref<LoadState>('idle')
const isLoadingMore = ref(false)

let pollTimer: ReturnType<typeof setTimeout> | undefined
let bells = 0

async function refreshUnread() {
  try {
    const result = await withErrorMode('silent', () =>
      api.notifications.getUnreadNotifications())

    unread.value = result.count
  }
  catch {}
}

/** Список открытого поповера: первая страница заново, прошлый список виден до ответа */
async function load() {
  state.value = items.value.length ? state.value : 'loading'

  try {
    const page = await withErrorMode('silent', () =>
      api.notifications.getNotifications({ limit: PAGE_SIZE }))

    items.value = page.items
    nextCursor.value = page.nextCursor
    unread.value = page.unread
    state.value = 'ready'
  }
  catch {
    if (!items.value.length)
      state.value = 'error'
  }
}

async function loadMore() {
  if (!nextCursor.value || isLoadingMore.value)
    return

  isLoadingMore.value = true

  try {
    const page = await api.notifications.getNotifications({
      limit: PAGE_SIZE,
      before: nextCursor.value,
    })
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

function markLocally(ids: Set<string> | 'all') {
  const now = new Date().toISOString()

  items.value = items.value.map(item =>
    !item.readAt && (ids === 'all' || ids.has(item.id))
      ? { ...item, readAt: now }
      : item,
  )
}

async function markRead(id: string) {
  const item = items.value.find(entry => entry.id === id)

  if (!item || item.readAt)
    return

  markLocally(new Set([id]))
  unread.value = Math.max(0, unread.value - 1)
  await api.notifications.markNotificationsRead({ ids: [id] })
}

async function markAllRead() {
  markLocally('all')
  unread.value = 0
  await api.notifications.markNotificationsRead({ all: true })
}

function stopPolling() {
  clearTimeout(pollTimer)
  pollTimer = undefined
}

function startPolling() {
  stopPolling()

  const tick = async () => {
    await refreshUnread()
    pollTimer = setTimeout(tick, UNREAD_POLL_MS)
  }

  void tick()
}

export function useNotifications() {
  return {
    unread: readonly(unread),
    items: computed(() => items.value),
    hasMore: computed(() => Boolean(nextCursor.value)),
    state: readonly(state),
    isLoadingMore: readonly(isLoadingMore),
    load,
    loadMore,
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
