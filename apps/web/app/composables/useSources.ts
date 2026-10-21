import type {
  CreateIndexerInput,
  CreateIndexerManagerInput,
  Indexer,
  IndexerManager,
  IndexerManagerSyncResult,
  SourceErrorResponse,
  UpdateIndexerInput,
} from '@torsher/api-client'
import { getErrorBody } from '@torsher/api-client'
import { needsAttention } from '~/lib/indexerStatus'
import { api } from '~/services/api'

export type SourceErrorKind = SourceErrorResponse['kind'] | 'unknown'
export type IndexersMode = NonNullable<
  NonNullable<
    Parameters<typeof api.indexerManagers.deleteIndexerManager>[1]
  >['indexers']
>
export type SourcesFilter = 'all' | 'attention' | 'disabled'

export interface SourcesGroup {
  key: string
  kind: 'attention' | 'manager' | 'manual'
  manager?: IndexerManager
  items: Indexer[]
}

export interface CheckRun {
  done: number
  total: number
}

type LoadState = 'idle' | 'loading' | 'error' | 'ready'

// Проверка индексаторов после импорта идёт на сервере после ответа:
// список перечитывается, пока результаты не придут
const POLL_INTERVAL_MS = 2000
const POLL_LIMIT_MS = 30_000
// «Проверить все» идёт запросами из панели: несколько сразу, чтобы не
// ждать каждый таймаут по очереди и не нагружать сервер десятками запросов
const CHECK_CONCURRENCY = 3

const FILTERS: SourcesFilter[] = ['all', 'attention', 'disabled']

const indexers = shallowRef<Indexer[]>([])
const managers = shallowRef<IndexerManager[]>([])
const state = ref<LoadState>('idle')
const checkingIds = shallowRef(new Set<string>())
const checkRun = shallowRef<CheckRun | null>(null)

let pollTimer: ReturnType<typeof setTimeout> | undefined

/** Вид ошибки проверки источника из ответа 422; остальное — `unknown` */
export async function sourceErrorKind(err: unknown): Promise<SourceErrorKind> {
  const body = await getErrorBody<Partial<SourceErrorResponse>>(err)

  return body?.kind ?? 'unknown'
}

function replaceIndexer(updated: Indexer) {
  indexers.value = indexers.value.map(item =>
    item.id === updated.id ? updated : item,
  )
}

function setChecking(ids: Iterable<string>) {
  checkingIds.value = new Set(ids)
}

function markChecking(id: string, isChecking: boolean) {
  const next = new Set(checkingIds.value)

  if (isChecking)
    next.add(id)
  else next.delete(id)

  checkingIds.value = next
}

async function fetchAll() {
  const [indexerList, managerList] = await Promise.all([
    api.indexers.getIndexers(),
    api.indexerManagers.getIndexerManagers(),
  ])

  indexers.value = indexerList.items
  managers.value = managerList.items
}

function isAwaitingCheck(indexer: Indexer, managerId: string, since: string) {
  return (
    indexer.managerId === managerId
    && indexer.enabled
    && !indexer.missing
    && (!indexer.checkedAt || indexer.checkedAt < since)
  )
}

function awaitingIds(managerId: string, since: string) {
  return indexers.value
    .filter(item => isAwaitingCheck(item, managerId, since))
    .map(item => item.id)
}

/** Время синхронизации — серверное, поэтому сравнение не зависит от часов браузера */
function pollChecks(managerId: string, since: string) {
  clearTimeout(pollTimer)

  const startedAt = Date.now()
  const total = awaitingIds(managerId, since).length

  if (total === 0)
    return

  setChecking(awaitingIds(managerId, since))
  checkRun.value = { done: 0, total }

  const tick = async () => {
    try {
      const list = await withErrorMode('silent', () =>
        api.indexers.getIndexers())

      indexers.value = list.items
    }
    catch {
      stopPolling()
      return
    }

    const pending = awaitingIds(managerId, since)

    setChecking(pending)
    checkRun.value = { done: total - pending.length, total }

    if (pending.length > 0 && Date.now() - startedAt < POLL_LIMIT_MS)
      pollTimer = setTimeout(tick, POLL_INTERVAL_MS)
    else stopPolling()
  }

  pollTimer = setTimeout(tick, POLL_INTERVAL_MS)
}

function finishRun() {
  setChecking([])
  checkRun.value = null
}

/** «Проверить все» не останавливаем: она идёт запросами панели и закончится сама */
function stopPolling() {
  if (!pollTimer)
    return

  clearTimeout(pollTimer)
  pollTimer = undefined
  finishRun()
}

async function afterSync(result: IndexerManagerSyncResult) {
  await fetchAll()

  if (result.manager.syncedAt)
    pollChecks(result.manager.id, result.manager.syncedAt)
}

async function load() {
  state.value = 'loading'

  try {
    await withErrorMode('silent', fetchAll)
    state.value = 'ready'
  }
  catch {
    state.value = 'error'
  }
}

async function testIndexer(id: string) {
  markChecking(id, true)

  try {
    const checked = await withErrorMode('silent', () =>
      api.indexers.postIndexerTest(id))

    replaceIndexer(checked)

    return checked
  }
  finally {
    markChecking(id, false)
  }
}

export function useSources() {
  const isEmpty = computed(
    () => indexers.value.length === 0 && managers.value.length === 0,
  )
  const attentionCount = computed(
    () => indexers.value.filter(needsAttention).length,
  )

  /** Для счётчика в навигации: список грузится один раз, а не на каждой странице */
  async function ensureLoaded() {
    if (state.value === 'idle')
      await load()
  }

  /** Ошибку проверки показывает форма: запрос в `silent` */
  async function importManager(body: CreateIndexerManagerInput) {
    const result = await withErrorMode('silent', () =>
      api.indexerManagers.postIndexerManager(body))

    await afterSync(result)

    return result
  }

  async function syncManager(id: string) {
    const result = await withErrorMode('silent', () =>
      api.indexerManagers.postIndexerManagerSync(id))

    await afterSync(result)

    return result
  }

  async function deleteManager(id: string, mode: IndexersMode) {
    await api.indexerManagers.deleteIndexerManager(id, { indexers: mode })
    await fetchAll()
  }

  async function createIndexer(body: CreateIndexerInput) {
    const created = await withErrorMode('silent', () =>
      api.indexers.postIndexer(body))

    indexers.value = [...indexers.value, created].sort((a, b) =>
      a.name.localeCompare(b.name),
    )

    return created
  }

  /** Новый ключ проверяем сразу: иначе строка показывала бы старый результат */
  async function updateIndexer(id: string, body: UpdateIndexerInput) {
    replaceIndexer(await api.indexers.patchIndexer(id, body))

    return body.apiKey ? testIndexer(id) : undefined
  }

  async function setEnabled(indexer: Indexer, enabled: boolean) {
    replaceIndexer(await api.indexers.patchIndexer(indexer.id, { enabled }))
  }

  async function deleteIndexer(id: string) {
    await api.indexers.deleteIndexer(id)
    indexers.value = indexers.value.filter(item => item.id !== id)
    managers.value = (await api.indexerManagers.getIndexerManagers()).items
  }

  /** Возвращает число работающих после проверки или `null`, если проверка уже идёт */
  async function checkAll() {
    if (checkRun.value)
      return null

    const queue = indexers.value.filter(item => item.enabled)
    const total = queue.length
    let done = 0
    let passed = 0

    checkRun.value = { done, total }
    setChecking(queue.map(item => item.id))

    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        try {
          const checked = await testIndexer(next.id)

          if (checked.checkStatus === 'ok')
            passed++
        }
        catch {
          // Строка покажет прежний статус, проверка остальных продолжается
        }

        done++
        checkRun.value = { done, total }
      }
    }

    await Promise.all(Array.from({ length: CHECK_CONCURRENCY }, worker))
    finishRun()

    return { passed, total }
  }

  function isChecking(id: string) {
    return checkingIds.value.has(id)
  }

  return {
    indexers: computed(() => indexers.value),
    managers: computed(() => managers.value),
    state: readonly(state),
    checkRun: readonly(checkRun),
    isEmpty,
    attentionCount,
    load,
    ensureLoaded,
    importManager,
    syncManager,
    deleteManager,
    createIndexer,
    updateIndexer,
    setEnabled,
    testIndexer,
    deleteIndexer,
    checkAll,
    isChecking,
    stopPolling,
  }
}

/**
 * Фильтр и поиск живут в `route.query`: ссылку на «Требуют внимания» можно
 * открыть из другого раздела, и она переживает перезагрузку.
 */
export function useSourcesList() {
  const route = useRoute()
  const router = useRouter()

  function setQuery(patch: Record<string, string | undefined>) {
    router.replace({ query: { ...route.query, ...patch } })
  }

  const filter = computed<SourcesFilter>({
    get: () => {
      const value = route.query.filter

      return FILTERS.includes(value as SourcesFilter)
        ? (value as SourcesFilter)
        : 'all'
    },
    set: value => setQuery({ filter: value === 'all' ? undefined : value }),
  })

  const search = computed({
    get: () => (typeof route.query.q === 'string' ? route.query.q : ''),
    set: value => setQuery({ q: value || undefined }),
  })

  const counts = computed(() => ({
    all: indexers.value.length,
    attention: indexers.value.filter(needsAttention).length,
    disabled: indexers.value.filter(item => !item.enabled).length,
  }))

  const groups = computed<SourcesGroup[]>(() => {
    const needle = search.value.trim().toLowerCase()
    const shown = indexers.value.filter((item) => {
      if (filter.value === 'attention' && !needsAttention(item))
        return false

      if (filter.value === 'disabled' && item.enabled)
        return false

      return !needle || item.name.toLowerCase().includes(needle)
    })
    const rest = shown.filter(item => !needsAttention(item))
    const result: SourcesGroup[] = []
    const attention = shown.filter(needsAttention)

    if (attention.length > 0)
      result.push({ key: 'attention', kind: 'attention', items: attention })

    // Пустой менеджер тоже показываем без фильтров: из его заголовка
    // синхронизируют и отключают
    const isUnfiltered = filter.value === 'all' && !needle

    for (const manager of managers.value) {
      const items = rest.filter(item => item.managerId === manager.id)

      if (items.length > 0 || isUnfiltered)
        result.push({ key: manager.id, kind: 'manager', manager, items })
    }

    const manual = rest.filter(item => !item.managerId)

    if (manual.length > 0)
      result.push({ key: 'manual', kind: 'manual', items: manual })

    return result
  })

  function resetFilters() {
    setQuery({ filter: undefined, q: undefined })
  }

  return { filter, search, counts, groups, resetFilters }
}
