import type { OverviewResponse } from '@torsher/api-client'
import type { LoadRange } from '~/lib/loadRanges'
import { useDocumentVisibility } from '@vueuse/core'
import { api } from '~/services/api'

type LoadState = 'idle' | 'loading' | 'error' | 'ready'

// Обзор смотрят «одним взглядом»: цифры свежие, но опрос реже, чем у загрузок
const POLL_INTERVAL_MS = 5000

const overview = shallowRef<OverviewResponse | null>(null)
const state = ref<LoadState>('idle')
const loadFresh = ref(false)
const range = ref<LoadRange>('15m')
let requestId = 0

let pollTimer: ReturnType<typeof setTimeout> | undefined
let pollGeneration = 0

async function fetchOverview() {
  const id = ++requestId
  try {
    const response = await withErrorMode('silent', () =>
      api.overview.getOverview({ range: range.value }))
    if (id === requestId) {
      overview.value = response
      loadFresh.value = true
    }
  }
  catch (err) {
    if (id === requestId)
      throw err
  }
}

async function load() {
  // Показанное остаётся на экране, пока идёт новый запрос, и ошибка его не прячет
  if (state.value !== 'ready')
    state.value = 'loading'

  try {
    await fetchOverview()
    state.value = 'ready'
  }
  catch {
    loadFresh.value = false
    if (state.value === 'loading')
      state.value = 'error'
  }
}

/** Фоновое обновление: ошибка не прячет прошлые цифры, следующий раз попробуем снова */
async function refresh() {
  try {
    await fetchOverview()
    state.value = 'ready'
  }
  catch {
    loadFresh.value = false
  }
}

function stopPolling() {
  pollGeneration++
  clearTimeout(pollTimer)
  pollTimer = undefined
}

function startPolling() {
  stopPolling()

  const generation = pollGeneration
  const tick = async () => {
    await refresh()
    if (generation === pollGeneration)
      pollTimer = setTimeout(tick, POLL_INTERVAL_MS)
  }

  pollTimer = setTimeout(tick, POLL_INTERVAL_MS)
}

export function useOverview() {
  return {
    overview: computed(() => overview.value),
    state: readonly(state),
    loadFresh: readonly(loadFresh),
    range: readonly(range),
    selectRange: (next: LoadRange) => {
      if (range.value === next)
        return
      range.value = next
      void refresh()
    },
    load,
    refresh,
  }
}

/**
 * Опрос «Обзора» на время жизни страницы и только в видимой вкладке:
 * фоновая вкладка не дёргает сервер, а вернувшись, сразу получает свежие цифры.
 */
export function useOverviewPolling() {
  const visibility = useDocumentVisibility()
  let mounted = false

  function syncPolling() {
    if (mounted && visibility.value === 'visible')
      startPolling()
    else stopPolling()
  }

  onMounted(async () => {
    mounted = true
    loadFresh.value = false

    // Повторный заход показывает прошлые цифры, пока идёт запрос
    await (overview.value ? refresh() : load())
    syncPolling()
  })

  watch(visibility, (value) => {
    loadFresh.value = false
    if (value === 'visible' && mounted)
      void refresh()

    syncPolling()
  })

  onBeforeUnmount(() => {
    mounted = false
    stopPolling()
  })
}
