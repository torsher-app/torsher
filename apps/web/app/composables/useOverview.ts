import type { OverviewResponse } from '@torsher/api-client'
import { useDocumentVisibility } from '@vueuse/core'
import { api } from '~/services/api'

type LoadState = 'idle' | 'loading' | 'error' | 'ready'

// Обзор смотрят «одним взглядом»: цифры свежие, но опрос реже, чем у загрузок
const POLL_INTERVAL_MS = 5000

const overview = shallowRef<OverviewResponse | null>(null)
const state = ref<LoadState>('idle')

let pollTimer: ReturnType<typeof setTimeout> | undefined

async function fetchOverview() {
  overview.value = await withErrorMode('silent', () =>
    api.overview.getOverview())
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
  catch {}
}

function stopPolling() {
  clearTimeout(pollTimer)
  pollTimer = undefined
}

function startPolling() {
  stopPolling()

  const tick = async () => {
    await refresh()
    pollTimer = setTimeout(tick, POLL_INTERVAL_MS)
  }

  pollTimer = setTimeout(tick, POLL_INTERVAL_MS)
}

export function useOverview() {
  return {
    overview: computed(() => overview.value),
    state: readonly(state),
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

    // Повторный заход показывает прошлые цифры, пока идёт запрос
    await (overview.value ? refresh() : load())
    syncPolling()
  })

  watch(visibility, (value) => {
    if (value === 'visible' && mounted)
      void refresh()

    syncPolling()
  })

  onBeforeUnmount(() => {
    mounted = false
    stopPolling()
  })
}
