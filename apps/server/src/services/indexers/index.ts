import type {
  FeedCursor,
  Indexer,
  IndexerCheckStatus,
  IndexerManager,
  IndexerManagerKind,
} from '../../db/schema.ts'
import type { TorznabCaps } from '../torznab/index.ts'
import type { RemoteIndexer } from './managers.ts'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { indexerManagers, indexers } from '../../db/schema.ts'
import { decryptSecret, encryptSecret, SecretError } from '../secrets/index.ts'
import {
  fetchCaps,
  normalizeTorznabUrl,
  SourceError,
} from '../torznab/index.ts'
import { listManagerIndexers, normalizeManagerUrl } from './managers.ts'
import { logFor } from '../logs/index.ts'

export { normalizeManagerUrl } from './managers.ts'

// Сколько проверок caps идёт одновременно после импорта
const CHECK_CONCURRENCY = 4
// Приоритет индексатора по умолчанию в Prowlarr
const DEFAULT_PRIORITY = 25

export interface IndexerWithManager extends Indexer {
  managerKind: IndexerManagerKind | null
}

export interface ManagerWithCounts extends IndexerManager {
  indexerCount: number
  missingCount: number
}

export interface SyncResult {
  manager: ManagerWithCounts
  added: number
  updated: number
  /** Сколько индексаторов менеджер больше не отдаёт */
  missing: number
  /** Индексаторы, которые нужно проверить после ответа */
  toCheck: string[]
}

function checkStatusOf(err: unknown): IndexerCheckStatus {
  if (!(err instanceof SourceError))
    throw err

  return err.kind === 'unsupported' ? 'bad_response' : err.kind
}

/**
 * Ключ, зашифрованный другим ключом сервера (сменили `TORSHER_SECRET` или
 * потеряли файл ключа), для пользователя — непринятый ключ: его вводят заново.
 */
function readStoredKey(ciphertext: string) {
  try {
    return decryptSecret(ciphertext)
  }
  catch (err) {
    if (!(err instanceof SecretError))
      throw err

    throw new SourceError(
      'auth',
      'Stored API key cannot be decrypted, enter it again',
      {
        cause: err,
      },
    )
  }
}

export function listIndexers(): IndexerWithManager[] {
  return getDb()
    .select()
    .from(indexers)
    .leftJoin(indexerManagers, eq(indexers.managerId, indexerManagers.id))
    .orderBy(indexers.name)
    .all()
    .map(row => ({
      ...row.indexers,
      managerKind: row.indexer_managers?.kind ?? null,
    }))
}

/** Индексатор, по которому можно искать раздачи */
export interface SearchableIndexer {
  id: string
  name: string
  url: string
  caps: TorznabCaps
  /** Расшифровывает ключ при запросе: битый ключ ломает только этот индексатор. */
  apiKey: () => string | undefined
}

/** Включённые индексаторы с известными caps, которые менеджер ещё отдаёт */
export function listSearchableIndexers(): SearchableIndexer[] {
  return getDb()
    .select()
    .from(indexers)
    .where(and(eq(indexers.enabled, true), eq(indexers.missing, false)))
    .orderBy(indexers.name)
    .all()
    .flatMap(({ id, name, url, caps, apiKey }) =>
      caps
        ? [
            {
              id,
              name,
              url,
              caps,
              apiKey: () => (apiKey ? readStoredKey(apiKey) : undefined),
            },
          ]
        : [],
    )
}

/** Индексатор, у которого можно читать ленту новых раздач */
export interface FeedIndexer extends SearchableIndexer {
  supportsRss: boolean | null
  rssCursor: FeedCursor | null
  rssCheckedAt: Date | null
  rssFailures: number
  priority: number | null
}

/**
 * Включённые индексаторы с удачной проверкой и текстовым поиском, у которых
 * Prowlarr не запретил ленту; по приоритету (без него — как у Prowlarr, 25)
 */
export function listFeedIndexers(): FeedIndexer[] {
  const rows = getDb()
    .select()
    .from(indexers)
    .where(
      and(
        eq(indexers.enabled, true),
        eq(indexers.missing, false),
        eq(indexers.checkStatus, 'ok'),
      ),
    )
    .orderBy(indexers.name)
    .all()

  return rows
    .flatMap(row =>
      row.caps?.search.available && row.supportsRss !== false
        ? [
            {
              id: row.id,
              name: row.name,
              url: row.url,
              caps: row.caps,
              apiKey: () =>
                row.apiKey ? readStoredKey(row.apiKey) : undefined,
              supportsRss: row.supportsRss,
              rssCursor: row.rssCursor,
              rssCheckedAt: row.rssCheckedAt,
              rssFailures: row.rssFailures,
              priority: row.priority,
            },
          ]
        : [],
    )
    .sort(
      (a, b) =>
        (a.priority ?? DEFAULT_PRIORITY) - (b.priority ?? DEFAULT_PRIORITY),
    )
}

export function getIndexer(id: string): IndexerWithManager | undefined {
  return listIndexers().find(indexer => indexer.id === id)
}

export interface NewIndexer {
  name: string
  url: string
  apiKey?: string
}

/**
 * Ручной индексатор сохраняется только после успешной проверки `t=caps`.
 * Ключ, вставленный в адрес (`?apikey=`), переносится в зашифрованное поле:
 * адрес хранится без query.
 */
export async function createManualIndexer(input: NewIndexer) {
  const apiKey
    = input.apiKey || new URL(input.url).searchParams.get('apikey') || undefined
  const url = normalizeTorznabUrl(input.url)
  const caps = await fetchCaps(url, apiKey)

  const row = getDb()
    .insert(indexers)
    .values({
      name: input.name,
      url,
      apiKey: apiKey ? encryptSecret(apiKey) : null,
      caps,
      checkStatus: 'ok',
      checkedAt: new Date(),
    })
    .returning({ id: indexers.id })
    .get()

  return getIndexer(row.id)!
}

export interface IndexerPatch {
  name?: string
  enabled?: boolean
  apiKey?: string
}

export function updateIndexer(id: string, patch: IndexerPatch) {
  const values: Partial<typeof indexers.$inferInsert> = {}

  if (patch.name !== undefined)
    values.name = patch.name

  if (patch.enabled !== undefined)
    values.enabled = patch.enabled

  // Новый ключ сбрасывает результат проверки: старый к нему не относится
  if (patch.apiKey) {
    values.apiKey = encryptSecret(patch.apiKey)
    values.checkStatus = null
    values.checkedAt = null
  }

  if (Object.keys(values).length > 0)
    getDb().update(indexers).set(values).where(eq(indexers.id, id)).run()

  return getIndexer(id)
}

export function deleteIndexer(id: string) {
  return getDb().delete(indexers).where(eq(indexers.id, id)).run().changes > 0
}

export async function checkIndexer(id: string) {
  const indexer = getDb()
    .select()
    .from(indexers)
    .where(eq(indexers.id, id))
    .get()

  if (!indexer)
    return undefined

  let values: Partial<typeof indexers.$inferInsert>

  try {
    const apiKey = indexer.apiKey ? readStoredKey(indexer.apiKey) : undefined

    values = { caps: await fetchCaps(indexer.url, apiKey), checkStatus: 'ok' }
  }
  catch (err) {
    const kind = checkStatusOf(err)

    values = { checkStatus: kind }
    logFor('sources').warn(
      { indexerId: id, kind, err },
      'Indexer check failed',
    )
  }

  getDb()
    .update(indexers)
    .set({ ...values, checkedAt: new Date() })
    .where(eq(indexers.id, id))
    .run()

  return getIndexer(id)
}

/**
 * Проверка после импорта идёт после ответа: индексаторов может быть
 * много, а каждый отвечает до таймаута. Панель видит результат в списке.
 */
export async function checkIndexers(
  ids: string[],
  onError: (err: unknown) => void,
) {
  const queue = [...ids]

  async function worker() {
    for (let id = queue.shift(); id; id = queue.shift()) {
      try {
        await checkIndexer(id)
      }
      catch (err) {
        onError(err)
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CHECK_CONCURRENCY, ids.length) }, worker),
  )
}

export function listManagers(): ManagerWithCounts[] {
  return getDb()
    .select({
      manager: indexerManagers,
      indexerCount: sql<number>`count(${indexers.id})`,
      missingCount: sql<number>`coalesce(sum(${indexers.missing}), 0)`,
    })
    .from(indexerManagers)
    .leftJoin(indexers, eq(indexers.managerId, indexerManagers.id))
    .groupBy(indexerManagers.id)
    .orderBy(indexerManagers.createdAt)
    .all()
    .map(row => ({
      ...row.manager,
      indexerCount: Number(row.indexerCount),
      missingCount: Number(row.missingCount),
    }))
}

function getManager(id: string) {
  return listManagers().find(manager => manager.id === id)
}

/**
 * Синхронизация с менеджером: новые индексаторы добавляются, у известных
 * обновляются имя и адрес, исчезнувшие помечаются `missing` и не удаляются
 * молча. Включение индексатора пользователем не перетирается.
 */
function applyRemoteIndexers(
  manager: IndexerManager,
  apiKey: string,
  remote: RemoteIndexer[],
) {
  const db = getDb()
  const encryptedKey = encryptSecret(apiKey)
  const toCheck: string[] = []
  let added = 0
  let updated = 0

  db.transaction((tx) => {
    const existing = new Map(
      tx
        .select()
        .from(indexers)
        .where(eq(indexers.managerId, manager.id))
        .all()
        .map(indexer => [indexer.externalId, indexer]),
    )
    const seen = new Set<string>()

    for (const item of remote) {
      seen.add(item.externalId)

      const known = existing.get(item.externalId)
      const caps = item.caps ? { caps: item.caps } : {}
      const feed = {
        supportsRss: item.supportsRss ?? null,
        priority: item.priority ?? null,
      }

      if (!known) {
        const row = tx
          .insert(indexers)
          .values({
            name: item.name,
            url: item.url,
            apiKey: encryptedKey,
            enabled: item.enabled,
            managerId: manager.id,
            externalId: item.externalId,
            ...caps,
            ...feed,
          })
          .returning({ id: indexers.id, enabled: indexers.enabled })
          .get()

        added++

        if (row.enabled)
          toCheck.push(row.id)

        continue
      }

      const changed
        = known.name !== item.name || known.url !== item.url || known.missing

      tx.update(indexers)
        .set({
          name: item.name,
          url: item.url,
          apiKey: encryptedKey,
          missing: false,
          ...caps,
          ...feed,
        })
        .where(eq(indexers.id, known.id))
        .run()

      if (changed)
        updated++

      if (known.enabled)
        toCheck.push(known.id)
    }

    const gone = [...existing.values()]
      .filter(indexer => indexer.externalId && !seen.has(indexer.externalId))
      .map(indexer => indexer.id)

    if (gone.length > 0) {
      tx.update(indexers)
        .set({ missing: true })
        .where(inArray(indexers.id, gone))
        .run()
    }

    tx.update(indexerManagers)
      .set({ apiKey: encryptedKey, syncedAt: new Date() })
      .where(eq(indexerManagers.id, manager.id))
      .run()
  })

  const withCounts = getManager(manager.id)!

  return {
    manager: withCounts,
    added,
    updated,
    missing: withCounts.missingCount,
    toCheck,
  }
}

export interface NewManager {
  kind: IndexerManagerKind
  url: string
  apiKey: string
}

/**
 * Импорт из менеджера. Тот же менеджер (тип и адрес) повторно не заводится:
 * импорт обновляет его ключ и синхронизирует индексаторы. Пока список не
 * получен, в базе ничего не меняется.
 */
export async function importManager(input: NewManager): Promise<SyncResult> {
  const url = normalizeManagerUrl(input.url)
  const remote = await listManagerIndexers(input.kind, url, input.apiKey)
  const db = getDb()

  const manager
    = db
      .select()
      .from(indexerManagers)
      .where(
        and(eq(indexerManagers.kind, input.kind), eq(indexerManagers.url, url)),
      )
      .get()
      ?? db
        .insert(indexerManagers)
        .values({
          kind: input.kind,
          url,
          apiKey: encryptSecret(input.apiKey),
        })
        .returning()
        .get()

  return applyRemoteIndexers(manager, input.apiKey, remote)
}

export async function syncManager(id: string): Promise<SyncResult | undefined> {
  const manager = getDb()
    .select()
    .from(indexerManagers)
    .where(eq(indexerManagers.id, id))
    .get()

  if (!manager)
    return undefined

  const apiKey = readStoredKey(manager.apiKey)
  const remote = await listManagerIndexers(manager.kind, manager.url, apiKey)

  return applyRemoteIndexers(manager, apiKey, remote)
}

/**
 * `keep` оставляет индексаторы ручными: адрес и ключ у них свои, менеджер
 * больше не синхронизирует их. `delete` удаляет их вместе с менеджером.
 */
export function deleteManager(id: string, indexersMode: 'keep' | 'delete') {
  return getDb().transaction((tx) => {
    if (indexersMode === 'delete') {
      tx.delete(indexers).where(eq(indexers.managerId, id)).run()
    }
    else {
      tx.update(indexers)
        .set({ managerId: null, externalId: null, missing: false })
        .where(eq(indexers.managerId, id))
        .run()
    }

    return (
      tx.delete(indexerManagers).where(eq(indexerManagers.id, id)).run().changes > 0
    )
  })
}
