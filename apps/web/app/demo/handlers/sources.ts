import type {
  AttentionItem,
  CreateIndexerInput,
  CreateIndexerManagerInput,
  DiscoverManagersResult,
  Indexer,
  IndexerList,
  IndexerManager,
  IndexerManagerList,
  IndexerManagerSyncResult,
  MessageResponse,
  OverviewResponse,
  SourceErrorResponse,
  UpdateIndexerInput,
} from '@torsher/api-client'
import { del, DemoError, get, patch, post } from '../router'
import { ago, isFresh, MINUTE, nextId } from '../state'

type ManagerKind = IndexerManager['kind']

interface DemoManager {
  id: string
  kind: ManagerKind
  url: string
  syncedAt: string | null
}

export const DEMO_MANAGER_URL = 'http://manager.example:9696'

const CATEGORIES: Indexer['categories'] = [
  { id: 2000, name: 'Movies' },
  { id: 5000, name: 'TV' },
  { id: 5070, name: 'TV/Anime' },
]

const SEARCH_MODES: NonNullable<Indexer['searchModes']> = {
  search: true,
  tvSearch: true,
  movieSearch: true,
}

// Что «отдаёт» менеджер при импорте: у Prowlarr и Jackett свой вид адреса
// Torznab, как у настоящих
const MANAGER_INDEXERS = ['Demo indexer', 'Anime indexer', 'Public indexer']

function managerIndexerUrl(kind: ManagerKind, base: string, index: number) {
  return kind === 'prowlarr'
    ? `${base}/${index + 1}/api`
    : `${base}/api/v2.0/indexers/demo-${index + 1}/results/torznab/`
}

function indexerOf(
  fields: Partial<Indexer> & Pick<Indexer, 'id' | 'name' | 'url'>,
): Indexer {
  return {
    hasApiKey: true,
    enabled: true,
    managerId: null,
    managerKind: null,
    missing: false,
    categories: CATEGORIES,
    searchModes: SEARCH_MODES,
    checkStatus: 'ok',
    checkedAt: ago(20 * MINUTE),
    feed: { supported: true, checkedAt: ago(9 * MINUTE), probeAt: null },
    ...fields,
  }
}

const managers: DemoManager[] = isFresh
  ? []
  : [
      {
        id: 'mgr-prowlarr',
        kind: 'prowlarr',
        url: DEMO_MANAGER_URL,
        syncedAt: ago(26 * 60 * MINUTE),
      },
    ]

let indexers: Indexer[] = isFresh
  ? []
  : [
      indexerOf({
        id: 'idx-demo',
        name: 'Demo indexer',
        url: managerIndexerUrl('prowlarr', DEMO_MANAGER_URL, 0),
        managerId: 'mgr-prowlarr',
        managerKind: 'prowlarr',
      }),
      indexerOf({
        id: 'idx-anime',
        name: 'Anime indexer',
        url: managerIndexerUrl('prowlarr', DEMO_MANAGER_URL, 1),
        managerId: 'mgr-prowlarr',
        managerKind: 'prowlarr',
        checkedAt: ago(21 * MINUTE),
        feed: { supported: false, checkedAt: null, probeAt: null },
      }),
      indexerOf({
        id: 'idx-public',
        name: 'Public indexer',
        url: managerIndexerUrl('prowlarr', DEMO_MANAGER_URL, 2),
        managerId: 'mgr-prowlarr',
        managerKind: 'prowlarr',
        enabled: false,
        checkedAt: ago(9 * 24 * 60 * MINUTE),
        feed: { supported: null, checkedAt: null, probeAt: null },
      }),
      indexerOf({
        id: 'idx-home',
        name: 'Home indexer',
        url: 'http://indexer.example:8080/api',
        checkStatus: 'auth',
        checkedAt: ago(35 * MINUTE),
        feed: { supported: null, checkedAt: null, probeAt: null },
      }),
    ]

// Индексаторы, у которых «сервер» отклоняет ключ, пока его не заменят
const rejectedKeys = new Set(isFresh ? [] : ['idx-home'])
// Проверка после импорта идёт «после ответа»: результат появляется в момент
// из этой карты, и опрос панели видит, как индексаторы проверяются по одному
const checkDue = new Map<string, number>()

const CHECK_STEP_MS = 1500

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function isDemoHost(url: string) {
  try {
    return new URL(url).hostname.endsWith('.example')
  }
  catch {
    return false
  }
}

function sourceError(kind: SourceErrorResponse['kind'], message: string) {
  return new DemoError(422, { kind, message } satisfies SourceErrorResponse)
}

function checkResult(indexer: Indexer): Indexer['checkStatus'] {
  if (rejectedKeys.has(indexer.id))
    return 'auth'

  return isDemoHost(indexer.url) ? 'ok' : 'unreachable'
}

/** Проверки, время которых пришло, записываются в индексатор */
function settleChecks() {
  const now = Date.now()

  for (const [id, due] of checkDue) {
    if (due > now)
      continue

    checkDue.delete(id)
    indexers = indexers.map(item =>
      item.id === id
        ? {
            ...item,
            checkStatus: checkResult(item),
            checkedAt: new Date(due).toISOString(),
          }
        : item,
    )
  }
}

function scheduleChecks(ids: string[], from: number) {
  ids.forEach((id, index) =>
    checkDue.set(id, from + (index + 1) * CHECK_STEP_MS),
  )
}

function findIndexer(id: string) {
  settleChecks()

  const found = indexers.find(item => item.id === id)
  if (!found)
    throw new DemoError(404, { message: 'Indexer not found' })

  return found
}

function replaceIndexer(updated: Indexer) {
  indexers = indexers.map(item => (item.id === updated.id ? updated : item))
  return updated
}

function managerView(manager: DemoManager): IndexerManager {
  const own = indexers.filter(item => item.managerId === manager.id)

  return {
    ...manager,
    indexerCount: own.length,
    missingCount: own.filter(item => item.missing).length,
  }
}

function findManager(id: string) {
  const found = managers.find(item => item.id === id)
  if (!found)
    throw new DemoError(404, { message: 'Indexer manager not found' })

  return found
}

/**
 * Импорт и повторный импорт: новые индексаторы добавляются, известные
 * обновляются, все включённые проверяются после ответа
 */
function syncManager(manager: DemoManager): IndexerManagerSyncResult {
  const now = Date.now()
  let added = 0
  let updated = 0

  MANAGER_INDEXERS.forEach((name, index) => {
    const url = managerIndexerUrl(manager.kind, manager.url, index)
    const known = indexers.find(
      item => item.managerId === manager.id && item.url === url,
    )

    if (known) {
      updated++
      return
    }

    added++
    indexers.push(
      indexerOf({
        id: nextId('idx'),
        name,
        url,
        managerId: manager.id,
        managerKind: manager.kind,
        checkStatus: null,
        checkedAt: null,
        feed: {
          // У Jackett ленту владелец включает сам, Prowlarr отдаёт её признак
          supported: manager.kind === 'prowlarr' ? true : null,
          checkedAt: null,
          probeAt: null,
        },
      }),
    )
  })

  manager.syncedAt = new Date(now).toISOString()
  scheduleChecks(
    indexers
      .filter(
        item =>
          item.managerId === manager.id && item.enabled && !item.missing,
      )
      .map(item => item.id),
    now,
  )

  return {
    manager: managerView(manager),
    added,
    updated,
    missing: indexers.filter(
      item => item.managerId === manager.id && item.missing,
    ).length,
  }
}

get<IndexerList>('/api/indexers', () => {
  settleChecks()
  return { items: indexers }
})

post<Indexer, CreateIndexerInput>('/api/indexers', async ({ body }) => {
  // Проверка адреса «идёт по сети»: короткая пауза, чтобы кнопка показала её
  await sleep(700)

  if (!isDemoHost(body.url)) {
    throw sourceError(
      'unreachable',
      'Could not reach the indexer. In the demo only addresses on .example respond.',
    )
  }

  const created = indexerOf({
    id: nextId('idx'),
    name: body.name,
    url: body.url,
    hasApiKey: Boolean(body.apiKey),
    checkedAt: new Date().toISOString(),
    feed: { supported: null, checkedAt: null, probeAt: null },
  })

  indexers.push(created)
  return created
})

patch<Indexer, UpdateIndexerInput>('/api/indexers/:id', ({ params, body }) => {
  const current = findIndexer(params.id!)

  if (body.feed !== undefined && current.managerKind === 'prowlarr')
    throw new DemoError(400, { message: 'feed_managed' })

  if (body.apiKey)
    rejectedKeys.delete(current.id)

  return replaceIndexer({
    ...current,
    name: body.name ?? current.name,
    enabled: body.enabled ?? current.enabled,
    hasApiKey: body.apiKey ? true : current.hasApiKey,
    feed:
      body.feed === undefined
        ? current.feed
        : {
            ...current.feed,
            supported: body.feed ? null : false,
            probeAt: null,
          },
  })
})

del<MessageResponse>('/api/indexers/:id', ({ params }) => {
  const current = findIndexer(params.id!)

  indexers = indexers.filter(item => item.id !== current.id)
  checkDue.delete(current.id)
  rejectedKeys.delete(current.id)

  return { message: 'Indexer deleted' }
})

post<Indexer>('/api/indexers/:id/test', async ({ params }) => {
  findIndexer(params.id!)
  await sleep(900)

  const current = findIndexer(params.id!)
  checkDue.delete(current.id)

  return replaceIndexer({
    ...current,
    checkStatus: checkResult(current),
    checkedAt: new Date().toISOString(),
  })
})

get<IndexerManagerList>('/api/indexer-managers', () => {
  settleChecks()
  return { items: managers.map(managerView) }
})

post<IndexerManagerSyncResult, CreateIndexerManagerInput>(
  '/api/indexer-managers',
  async ({ body }) => {
    await sleep(900)

    if (!isDemoHost(body.url)) {
      throw sourceError(
        'unreachable',
        `Could not reach the manager. In the demo it lives at ${DEMO_MANAGER_URL}.`,
      )
    }

    const url = body.url.replace(/\/+$/, '')
    let manager = managers.find(
      item => item.url === url && item.kind === body.kind,
    )

    if (!manager) {
      manager = { id: nextId('mgr'), kind: body.kind, url, syncedAt: null }
      managers.push(manager)
    }

    return syncManager(manager)
  },
)

post<IndexerManagerSyncResult>(
  '/api/indexer-managers/:id/sync',
  async ({ params }) => {
    const manager = findManager(params.id!)

    await sleep(700)
    return syncManager(manager)
  },
)

del<MessageResponse>('/api/indexer-managers/:id', ({ params, query }) => {
  const manager = findManager(params.id!)

  if (query.get('indexers') === 'delete') {
    indexers = indexers.filter(item => item.managerId !== manager.id)
  }
  else {
    indexers = indexers.map(item =>
      item.managerId === manager.id
        ? { ...item, managerId: null, managerKind: null, missing: false }
        : item,
    )
  }

  managers.splice(managers.indexOf(manager), 1)
  return { message: 'Indexer manager deleted' }
})

post<DiscoverManagersResult>('/api/setup/discover-managers', async () => {
  // Опрос адресов локальной сети занимает пару секунд и у сервера
  await sleep(1200)
  return { items: [{ kind: 'prowlarr', url: DEMO_MANAGER_URL }] }
})

/** Менеджеры и ручные индексаторы: их хосты проверяет «Настройки → Сеть» */
export function sourceHosts() {
  return [
    ...managers.map(manager => ({
      kind: 'manager' as const,
      label: manager.kind === 'prowlarr' ? 'Prowlarr' : 'Jackett',
      url: manager.url,
    })),
    ...indexers
      .filter(item => !item.managerId)
      .map(item => ({
        kind: 'indexer' as const,
        label: item.name,
        url: item.url,
      })),
  ]
}

export function sourceStats(): OverviewResponse['sources'] {
  settleChecks()

  const enabled = indexers.filter(item => item.enabled)

  return {
    ok: enabled.filter(item => item.checkStatus === 'ok' && !item.missing)
      .length,
    total: enabled.length,
  }
}

/** Проблема с несколькими элементами: у одного в тексте его имя, иначе — число */
function counted(names: string[]): AttentionItem['params'] {
  return names.length === 1
    ? { count: 1, name: names[0] }
    : { count: names.length }
}

export function sourceAttention(): AttentionItem[] {
  settleChecks()

  const enabled = indexers.filter(item => item.enabled)
  // Пропажа из менеджера важнее ошибки проверки, как в списке «Источников»
  const missing = enabled.filter(item => item.missing)
  const failed = enabled.filter(
    item => !item.missing && item.checkStatus && item.checkStatus !== 'ok',
  )
  const items: AttentionItem[] = []

  if (failed.length) {
    items.push({
      kind: 'indexer_error',
      severity: 'error',
      section: 'sources',
      params: counted(failed.map(item => item.name)),
    })
  }

  if (missing.length) {
    items.push({
      kind: 'indexer_missing',
      severity: 'warning',
      section: 'sources',
      params: counted(missing.map(item => item.name)),
    })
  }

  return items
}
