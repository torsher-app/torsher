import type {
  CreateIndexerInput,
  CreateIndexerManagerInput,
  Indexer,
  IndexerManager,
  IndexerManagerSyncResult,
  SourceErrorResponse,
} from '@torsher/api-client'
import { getErrorBody } from '@torsher/api-client'
import { api } from '~/services/api'

export type SourceErrorKind = SourceErrorResponse['kind'] | 'unknown'
export type IndexersMode = NonNullable<
  NonNullable<
    Parameters<typeof api.indexerManagers.deleteIndexerManager>[1]
  >['indexers']
>

type LoadState = 'loading' | 'error' | 'ready'

// Проверка индексаторов после импорта идёт на сервере после ответа:
// список перечитывается, пока результаты не придут
const POLL_INTERVAL_MS = 2000
const POLL_LIMIT_MS = 30_000

const indexers = shallowRef<Indexer[]>([])
const managers = shallowRef<IndexerManager[]>([])
const state = ref<LoadState>('loading')

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

/** Время синхронизации — серверное, поэтому сравнение не зависит от часов браузера */
function pollChecks(managerId: string, since: string) {
  clearTimeout(pollTimer)

  const startedAt = Date.now()

  const tick = async () => {
    try {
      const list = await withErrorMode('silent', () =>
        api.indexers.getIndexers())

      indexers.value = list.items
    }
    catch {
      return
    }

    const pending = indexers.value.some(item =>
      isAwaitingCheck(item, managerId, since),
    )

    if (pending && Date.now() - startedAt < POLL_LIMIT_MS)
      pollTimer = setTimeout(tick, POLL_INTERVAL_MS)
  }

  pollTimer = setTimeout(tick, POLL_INTERVAL_MS)
}

async function afterSync(result: IndexerManagerSyncResult) {
  await fetchAll()

  if (result.manager.syncedAt)
    pollChecks(result.manager.id, result.manager.syncedAt)
}

export function useSources() {
  const isEmpty = computed(
    () => indexers.value.length === 0 && managers.value.length === 0,
  )

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

  async function setEnabled(indexer: Indexer, enabled: boolean) {
    replaceIndexer(await api.indexers.patchIndexer(indexer.id, { enabled }))
  }

  async function testIndexer(id: string) {
    const checked = await api.indexers.postIndexerTest(id)

    replaceIndexer(checked)

    return checked
  }

  async function deleteIndexer(id: string) {
    await api.indexers.deleteIndexer(id)
    indexers.value = indexers.value.filter(item => item.id !== id)
    managers.value = (await api.indexerManagers.getIndexerManagers()).items
  }

  function stopPolling() {
    clearTimeout(pollTimer)
  }

  return {
    indexers: computed(() => indexers.value),
    managers: computed(() => managers.value),
    state: readonly(state),
    isEmpty,
    load,
    importManager,
    syncManager,
    deleteManager,
    createIndexer,
    setEnabled,
    testIndexer,
    deleteIndexer,
    stopPolling,
  }
}
