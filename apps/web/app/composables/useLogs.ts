import type { LogEntry, LogsResponse } from '@torsher/api-client'
import type { LogLevel, LogsLevelFilter, LogSource } from '~/lib/logs'
import { refDebounced, useDocumentVisibility, useNow } from '@vueuse/core'
import { getErrorStatus } from '@torsher/api-client'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import { copyText } from '~/lib/clipboard'
import {
  dayKeyOf,
  formatLogDay,
  formatLogEntry,
  isLogSource,
  LEVEL_FILTERS,
  logFileName,
} from '~/lib/logs'
import { api } from '~/services/api'

type LoadState = 'idle' | 'loading' | 'error' | 'ready'
type Query = NonNullable<Parameters<typeof api.logs.getLogs>[0]>

const POLL_INTERVAL_MS = 3000
const PAGE_SIZE = 200
const SEARCH_DEBOUNCE_MS = 300
// Поток быстрее опроса не должен держать вкладку в бесконечном дочитывании
const MAX_CATCH_UP_PAGES = 5
// Ёмкость буфера сервера: дольше живая вкладка не копит
const MAX_ENTRIES = 5000

// Новые сверху
const entries = shallowRef<LogEntry[]>([])
// Пришли, пока список прокручен вниз: вливаются по клику или у начала списка
const pending = shallowRef<LogEntry[]>([])
const state = ref<LoadState>('idle')
// Перезагрузка после смены фильтра: строка фильтров остаётся на месте
const isReloading = ref(false)
const hasMore = ref(false)
const isLoadingMore = ref(false)
const journalLevel = ref<LogLevel>('info')
const levelLocked = ref(false)
const isLevelBusy = ref(false)
const isDownloading = ref(false)
const isPaused = ref(false)
const isAtTop = ref(true)

// Ответ на устаревший фильтр не должен попасть в список
let generation = 0
let latestSeq = 0
let pollTimer: ReturnType<typeof setTimeout> | undefined
let isPolling = false
// Id журнала сервера: после перезапуска нумерация `seq` начинается заново
let instance: string | undefined
// Поиск, с которым загружен список: поле меняется на каждую букву раньше
// перезагрузки, и опрос с ним смешал бы в списке два фильтра
let loadedSearch = ''

/** Заменяет записи с теми же `id` и ставит свежие наверх: склеенный повтор поднимается */
function mergeNewer(list: LogEntry[], newer: LogEntry[]) {
  if (!newer.length)
    return list

  const ids = new Set(newer.map(entry => entry.id))

  return [...newer, ...list.filter(entry => !ids.has(entry.id))]
}

function setEntries(list: LogEntry[]) {
  if (list.length > MAX_ENTRIES) {
    entries.value = list.slice(0, MAX_ENTRIES)
    hasMore.value = true
  }
  else {
    entries.value = list
  }
}

function track(list: LogEntry[]) {
  for (const entry of list) latestSeq = Math.max(latestSeq, entry.seq)
}

function applyMeta(response: LogsResponse) {
  journalLevel.value = response.level
  levelLocked.value = response.levelLocked
}

function stopPolling() {
  clearTimeout(pollTimer)
  pollTimer = undefined
}

export function useLogs() {
  const { t, locale } = useI18n()
  const route = useRoute()
  const router = useRouter()

  function setQuery(patch: Record<string, string | undefined>) {
    router.replace({ query: { ...route.query, ...patch } })
  }

  const levelFilter = computed<LogsLevelFilter>({
    get: () => {
      const value = route.query.level

      return LEVEL_FILTERS.includes(value as LogsLevelFilter)
        ? (value as LogsLevelFilter)
        : 'all'
    },
    set: value => setQuery({ level: value === 'all' ? undefined : value }),
  })

  const source = computed<LogSource | null>({
    get: () => (isLogSource(route.query.source) ? route.query.source : null),
    set: value => setQuery({ source: value ?? undefined }),
  })

  const search = computed({
    get: () => (typeof route.query.q === 'string' ? route.query.q : ''),
    set: value => setQuery({ q: value || undefined }),
  })

  const isFiltered = computed(
    () => levelFilter.value !== 'all' || !!source.value || !!search.value,
  )

  // Счётчик чипа честен, только если его записи целиком среди загруженных
  const counts = computed(() => {
    const rank = LEVEL_FILTERS.indexOf(levelFilter.value)
    const count = (filter: LogsLevelFilter) =>
      LEVEL_FILTERS.indexOf(filter) < rank
        ? undefined
        : entries.value.filter(
          entry =>
            filter === 'all'
            || entry.level === 'error'
            || (filter === 'warn' && entry.level === 'warn'),
        ).length

    return {
      all: count('all'),
      warn: count('warn'),
      error: count('error'),
    } satisfies Record<LogsLevelFilter, number | undefined>
  })

  const now = useNow({ interval: 60_000 })

  const groups = computed(() => {
    const today = now.value
    const yesterday = new Date(today)

    yesterday.setDate(today.getDate() - 1)

    const todayKey = dayKeyOf(today)
    const yesterdayKey = dayKeyOf(yesterday)
    const result: { key: string, title: string, items: LogEntry[] }[] = []

    for (const entry of entries.value) {
      const date = new Date(entry.time)
      const key = dayKeyOf(date)
      let group = result.at(-1)

      if (group?.key !== key) {
        group = {
          key,
          title:
            key === todayKey
              ? t('panel.logs.groups.today')
              : key === yesterdayKey
                ? t('panel.logs.groups.yesterday')
                : formatLogDay(date, locale.value, today),
          items: [],
        }
        result.push(group)
      }

      group.items.push(entry)
    }

    return result
  })

  function resetFilters() {
    setQuery({ level: undefined, source: undefined, q: undefined })
  }

  function baseQuery(q = loadedSearch): Query {
    // «Все» при обычном журнале — без отладочных записей, оставшихся от
    // включённого ранее подробного журнала
    const minimum
      = levelFilter.value === 'all'
        ? journalLevel.value === 'debug'
          ? 'debug'
          : 'info'
        : levelFilter.value
    const query: Query = { level: minimum, limit: PAGE_SIZE }

    if (source.value)
      query.source = source.value
    if (q)
      query.q = q

    return query
  }

  function fetchLogs(query: Query) {
    return withErrorMode('silent', () => api.logs.getLogs(query))
  }

  async function load() {
    const current = ++generation
    const isFirst = state.value !== 'ready'

    if (isFirst)
      state.value = 'loading'
    else isReloading.value = true

    loadedSearch = search.value.trim()

    try {
      let response = await fetchLogs(baseQuery())

      // Уровень журнала известен только из ответа: при подробном журнале
      // «Все» включает отладку, и первую страницу берём заново
      if (
        current === generation
        && levelFilter.value === 'all'
        && response.level === 'debug'
        && journalLevel.value !== 'debug'
      ) {
        applyMeta(response)
        response = await fetchLogs(baseQuery())
      }

      if (current !== generation)
        return

      applyMeta(response)
      instance = response.instance
      entries.value = response.entries
      pending.value = []
      hasMore.value = response.hasMore
      latestSeq = 0
      track(response.entries)
      // Новый список отрисован с начала
      isAtTop.value = true
      state.value = 'ready'
    }
    catch {
      if (current === generation)
        state.value = 'error'
    }
    finally {
      if (current === generation)
        isReloading.value = false
    }
  }

  async function loadMore() {
    const oldest = entries.value.reduce(
      (min, entry) => Math.min(min, entry.seq),
      Number.POSITIVE_INFINITY,
    )

    if (!hasMore.value || isLoadingMore.value || !Number.isFinite(oldest))
      return

    const current = generation

    isLoadingMore.value = true

    try {
      const response = await fetchLogs({ ...baseQuery(), before: oldest })

      if (current !== generation)
        return

      if (response.instance !== instance) {
        void load()
        return
      }

      const ids = new Set(entries.value.map(entry => entry.id))

      entries.value = [
        ...entries.value,
        ...response.entries.filter(entry => !ids.has(entry.id)),
      ]
      hasMore.value = response.hasMore
    }
    catch {
      toast.error(t('panel.logs.loadError'), {
        description: t('panel.logs.loadErrorText'),
      })
    }
    finally {
      isLoadingMore.value = false
    }
  }

  /** Новые записи от курсора; ошибка не прячет загруженное — попробуем в следующий раз */
  async function poll() {
    if (isPolling || state.value !== 'ready' || isReloading.value)
      return

    const current = generation

    isPolling = true

    try {
      for (let page = 0; page < MAX_CATCH_UP_PAGES; page++) {
        const response = await fetchLogs({ ...baseQuery(), after: latestSeq })

        if (current !== generation)
          return

        if (response.instance !== instance) {
          void load()
          return
        }

        applyMeta(response)
        track(response.entries)

        if (isAtTop.value) {
          setEntries(mergeNewer(entries.value, response.entries))
        }
        else {
          pending.value = mergeNewer(pending.value, response.entries).slice(
            0,
            MAX_ENTRIES,
          )
        }

        if (!response.hasMore)
          break
      }
    }
    catch {
    }
    finally {
      isPolling = false
    }
  }

  function showPending() {
    setEntries(mergeNewer(entries.value, pending.value))
    pending.value = []
  }

  /** Список сообщает, у начала ли он: только там новые записи вливаются сразу */
  function setAtTop(value: boolean) {
    isAtTop.value = value

    if (value && pending.value.length)
      showPending()
  }

  function setPaused(value: boolean) {
    isPaused.value = value
  }

  async function setLevel(level: 'info' | 'debug') {
    if (isLevelBusy.value)
      return

    isLevelBusy.value = true

    try {
      const response = await withErrorMode('silent', () =>
        api.logs.putLogLevel({ level }))

      journalLevel.value = response.level

      const enabled = response.level === 'debug'

      toast.success(
        t(
          enabled
            ? 'panel.logs.verbose.enabled'
            : 'panel.logs.verbose.disabled',
        ),
        {
          description: t(
            enabled
              ? 'panel.logs.verbose.enabledText'
              : 'panel.logs.verbose.disabledText',
          ),
        },
      )

      if (levelFilter.value === 'all')
        void load()
    }
    catch (err) {
      const isLocked = getErrorStatus(err) === 409

      if (isLocked)
        levelLocked.value = true

      toast.error(t('panel.logs.verbose.error'), {
        description: isLocked ? t('panel.logs.verbose.lockedError') : undefined,
      })
    }
    finally {
      isLevelBusy.value = false
    }
  }

  async function download() {
    if (isDownloading.value)
      return

    isDownloading.value = true

    try {
      // Роут скрыт из OpenAPI: generated-метода нет, но ядро клиента с
      // refresh сессии работает и для ручного запроса
      const blob = await withErrorMode('silent', () =>
        api.request<Blob>({
          path: '/api/logs/download',
          method: 'GET',
          format: 'blob',
        }))
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')

      link.href = url
      link.download = logFileName()
      document.body.append(link)
      link.click()
      link.remove()
      // Отзыв в том же тике может оборвать скачивание в некоторых браузерах
      setTimeout(() => URL.revokeObjectURL(url), 0)
    }
    catch {
      toast.error(t('panel.logs.download.error'), {
        description: t('panel.logs.download.errorText'),
      })
    }
    finally {
      isDownloading.value = false
    }
  }

  async function copyEntry(entry: LogEntry) {
    try {
      await copyText(formatLogEntry(entry))
      toast.success(t('panel.logs.card.copied'))
    }
    catch {
      toast.error(t('panel.logs.card.copyError'))
    }
  }

  return {
    entries: computed(() => entries.value),
    pendingCount: computed(() => pending.value.length),
    groups,
    state: readonly(state),
    isReloading: readonly(isReloading),
    hasMore: readonly(hasMore),
    isLoadingMore: readonly(isLoadingMore),
    journalLevel: readonly(journalLevel),
    levelLocked: readonly(levelLocked),
    isLevelBusy: readonly(isLevelBusy),
    isDownloading: readonly(isDownloading),
    isPaused: readonly(isPaused),
    levelFilter,
    source,
    search,
    isFiltered,
    counts,
    load,
    loadMore,
    poll,
    showPending,
    setAtTop,
    setPaused,
    setLevel,
    download,
    copyEntry,
    resetFilters,
  }
}

/**
 * Жизненный цикл журнала на странице: первая загрузка, перезагрузка при смене
 * фильтра и живое обновление — только в видимой вкладке и не на паузе;
 * вернувшись во вкладку или сняв паузу, сразу дочитываем новое.
 */
export function useLogsFeed(logs: ReturnType<typeof useLogs>) {
  const visibility = useDocumentVisibility()
  const searchQuery = refDebounced(logs.search, SEARCH_DEBOUNCE_MS)
  let mounted = false

  function syncPolling() {
    stopPolling()

    if (
      mounted
      && visibility.value === 'visible'
      && !logs.isPaused.value
      && logs.state.value === 'ready'
    ) {
      pollTimer = setTimeout(tick, POLL_INTERVAL_MS)
    }
  }

  async function tick() {
    await logs.poll()
    syncPolling()
  }

  async function reload() {
    await logs.load()
    syncPolling()
  }

  onMounted(async () => {
    mounted = true
    state.value = 'idle'
    isAtTop.value = true
    isPaused.value = false
    await reload()
  })

  // Поиск — с задержкой, чтобы не перезагружать журнал на каждую букву
  watch([logs.levelFilter, logs.source, searchQuery], () => {
    if (mounted)
      void reload()
  })

  watch([visibility, logs.isPaused], async ([value, paused]) => {
    if (!mounted)
      return

    if (value === 'visible' && !paused)
      await logs.poll()

    syncPolling()
  })

  onBeforeUnmount(() => {
    mounted = false
    generation++
    stopPolling()
  })

  return { reload }
}
