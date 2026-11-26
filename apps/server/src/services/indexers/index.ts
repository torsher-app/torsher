import { logSourceCheckError } from '../sources/logDiagnostics.ts'
import type {
  FeedCursor,
  Indexer,
  IndexerCheckStatus,
  IndexerManager,
  IndexerManagerKind,
  IndexerProtocol,
  NewznabOriginApproval,
} from '../../db/schema.ts'
import type { TorznabCaps } from '../torznab/index.ts'
import type { RemoteIndexer } from './managers.ts'
import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { indexerManagers, indexers } from '../../db/schema.ts'
import { decryptSecret, encryptSecret, SecretError } from '../secrets/index.ts'
import {
  fetchCaps,
  normalizeTorznabUrl,
  SourceError,
} from '../torznab/index.ts'
import {
  checkNewznab,
  normalizeDownloadOrigins,
  normalizeNewznabUrl,
} from '../newznab/client.ts'
import { TrustedHttpError, trustedUrl } from '../net/trustedHttp.ts'
import { listManagerIndexers, normalizeManagerUrl } from './managers.ts'
import { isSessionCookie } from '../torznab/cookie.ts'
import { rememberIndexerRetryAfter } from './backoff.ts'

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
      'Stored credentials cannot be decrypted, enter them again',
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
  sessionCookie?: () => string | undefined
  isPrivate?: boolean
  allowAutomation?: boolean
}

/** Включённые индексаторы с известными caps, которые менеджер ещё отдаёт */
export function listSearchableIndexers(): SearchableIndexer[] {
  return getDb()
    .select()
    .from(indexers)
    .where(
      and(
        eq(indexers.protocol, 'torznab'),
        eq(indexers.enabled, true),
        eq(indexers.missing, false),
      ),
    )
    .orderBy(indexers.name)
    .all()
    .flatMap(
      ({
        id,
        name,
        url,
        caps,
        apiKey,
        sessionCookie,
        isPrivate,
        allowAutomation,
      }) =>
        caps
          ? [
              {
                id,
                name,
                url,
                caps,
                isPrivate,
                allowAutomation,
                apiKey: () => (apiKey ? readStoredKey(apiKey) : undefined),
                sessionCookie: () =>
                  sessionCookie ? readStoredKey(sessionCookie) : undefined,
              },
            ]
          : [],
    )
}

/**
 * Есть ли по чему искать раздачи: те же условия, что у
 * `listSearchableIndexers`, без расшифровки ключей. Индексатор, который сейчас
 * не отвечает, источником остаётся: это сбой, а не отсутствие источников.
 */
export function hasSearchableIndexers() {
  const row = getDb()
    .select({ id: indexers.id })
    .from(indexers)
    .where(
      and(
        eq(indexers.protocol, 'torznab'),
        eq(indexers.enabled, true),
        eq(indexers.missing, false),
        isNotNull(indexers.caps),
      ),
    )
    .limit(1)
    .get()

  return row !== undefined
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
        eq(indexers.protocol, 'torznab'),
        eq(indexers.enabled, true),
        eq(indexers.missing, false),
        eq(indexers.checkStatus, 'ok'),
        eq(indexers.allowAutomation, true),
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
              isPrivate: row.isPrivate,
              allowAutomation: row.allowAutomation,
              apiKey: () =>
                row.apiKey ? readStoredKey(row.apiKey) : undefined,
              sessionCookie: () =>
                row.sessionCookie
                  ? readStoredKey(row.sessionCookie)
                  : undefined,
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

type PrivatePolicyPatch = Partial<
  Pick<
    Indexer,
    | 'isPrivate'
    | 'allowAutomation'
    | 'minSeedRatio'
    | 'minSeedTimeMinutes'
    | 'seedCriteriaMode'
  >
>

function privatePolicyPatch(patch: PrivatePolicyPatch) {
  const {
    isPrivate,
    allowAutomation,
    minSeedRatio,
    minSeedTimeMinutes,
    seedCriteriaMode,
  } = patch
  const policy = {
    isPrivate,
    allowAutomation,
    minSeedRatio,
    minSeedTimeMinutes,
    seedCriteriaMode,
  }
  return {
    ...policy,
    policyCustomized: Object.values(policy).some(value => value !== undefined)
      ? true
      : undefined,
  }
}

export interface NewIndexer extends PrivatePolicyPatch {
  name: string
  url: string
  apiKey?: string
  sessionCookie?: string | null
  protocol?: IndexerProtocol
  lanAddresses?: string[]
  downloadOrigins?: NewznabOriginApproval[]
}

/**
 * Ручной индексатор сохраняется только после успешной проверки `t=caps`.
 * Ключ, вставленный в адрес (`?apikey=`), переносится в зашифрованное поле:
 * адрес хранится без query.
 */
export async function createManualIndexer(input: NewIndexer) {
  const nzb = input.protocol === 'newznab'
  if (
    input.sessionCookie != null
    && (nzb || !isSessionCookie(input.sessionCookie))
  ) {
    throw new SourceError('auth', 'Invalid session cookie')
  }
  const apiKey
    = input.apiKey
      || (!nzb
        ? new URL(input.url).searchParams.get('apikey') || undefined
        : undefined)
  const url = nzb
    ? normalizeNewznabUrl(input.url)
    : normalizeTorznabUrl(input.url)
  const lanAddresses = nzb
    ? [...new Set(input.lanAddresses ?? [])].sort()
    : null
  const downloadOrigins = nzb
    ? normalizeDownloadOrigins(input.downloadOrigins ?? [])
    : null
  const caps = nzb
    ? await checkNewznab({ url, apiKey, lanAddresses })
    : await fetchCaps(url, apiKey, input.sessionCookie ?? undefined)

  const row = getDb()
    .insert(indexers)
    .values({
      name: input.name,
      url,
      protocol: input.protocol,
      lanAddresses,
      downloadOrigins,
      ...(nzb && { supportsRss: false }),
      apiKey: apiKey ? encryptSecret(apiKey) : null,
      sessionCookie: input.sessionCookie
        ? encryptSecret(input.sessionCookie)
        : null,
      caps,
      checkStatus: 'ok',
      checkedAt: new Date(),
      ...privatePolicyPatch(input),
    })
    .returning({ id: indexers.id })
    .get()

  return getIndexer(row.id)!
}

export interface IndexerPatch extends PrivatePolicyPatch {
  name?: string
  enabled?: boolean
  apiKey?: string
  sessionCookie?: string | null
  feed?: boolean
  lanAddresses?: string[]
  downloadOrigins?: NewznabOriginApproval[]
}

export function updateIndexer(id: string, patch: IndexerPatch) {
  const current = getIndexer(id)
  if (!current)
    return undefined
  const nzb = current.protocol === 'newznab'
  if (
    patch.sessionCookie != null
    && (nzb || !isSessionCookie(patch.sessionCookie))
  ) {
    throw new SourceError('auth', 'Invalid session cookie')
  }
  const values: Partial<typeof indexers.$inferInsert> = Object.fromEntries(
    Object.entries(privatePolicyPatch(patch)).filter(
      ([, value]) => value !== undefined,
    ),
  )

  if (nzb && patch.lanAddresses !== undefined) {
    values.lanAddresses = [...new Set(patch.lanAddresses)].sort()
    values.checkStatus = null
    values.checkedAt = null
  }
  if (nzb && patch.downloadOrigins !== undefined)
    values.downloadOrigins = normalizeDownloadOrigins(patch.downloadOrigins)

  if (patch.name !== undefined)
    values.name = patch.name

  if (patch.enabled !== undefined)
    values.enabled = patch.enabled

  // Включённая заново лента пробуется сразу, а не через неделю после неудач
  if (!nzb && patch.feed !== undefined) {
    values.supportsRss = patch.feed ? null : false
    values.rssFailures = 0
  }

  // Новый ключ сбрасывает результат проверки: старый к нему не относится
  if (patch.apiKey) {
    values.apiKey = encryptSecret(patch.apiKey)
    values.checkStatus = null
    values.checkedAt = null
  }

  if (patch.sessionCookie !== undefined) {
    values.sessionCookie = patch.sessionCookie
      ? encryptSecret(patch.sessionCookie)
      : null
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
  let retryAt: Date | undefined

  try {
    if (indexer.protocol === 'newznab' && indexer.lanAddresses === null) {
      throw new SourceError(
        'unreachable',
        'Source address must be verified again',
      )
    }
    const apiKey = indexer.apiKey ? readStoredKey(indexer.apiKey) : undefined

    const cookie = indexer.sessionCookie
      ? readStoredKey(indexer.sessionCookie)
      : undefined
    values = {
      caps:
        indexer.protocol === 'newznab'
          ? await checkNewznab({
              url: indexer.url,
              apiKey,
              lanAddresses: indexer.lanAddresses,
            })
          : await fetchCaps(indexer.url, apiKey, cookie),
      checkStatus: 'ok',
    }
  }
  catch (err) {
    const kind = checkStatusOf(err)

    values = { checkStatus: kind }
    if (err instanceof SourceError)
      retryAt = err.retryAt
    logSourceCheckError(err, { operation: 'indexer_check', indexerId: id })
  }

  const result = getDb()
    .update(indexers)
    .set({ ...values, checkedAt: new Date() })
    .where(
      and(
        eq(indexers.id, id),
        eq(indexers.url, indexer.url),
        eq(indexers.protocol, indexer.protocol),
        indexer.lanAddresses === null
          ? isNull(indexers.lanAddresses)
          : eq(indexers.lanAddresses, indexer.lanAddresses),
        indexer.apiKey === null
          ? isNull(indexers.apiKey)
          : eq(indexers.apiKey, indexer.apiKey),
        indexer.sessionCookie === null
          ? isNull(indexers.sessionCookie)
          : eq(indexers.sessionCookie, indexer.sessionCookie),
      ),
    )
    .run()

  if (result.changes && retryAt)
    rememberIndexerRetryAfter(id, retryAt)

  return getIndexer(id)
}

/**
 * Проверка после импорта идёт после ответа: индексаторов может быть
 * много, а каждый отвечает до таймаута. Панель видит результат в списке.
 */
export async function checkIndexers(
  ids: string[],
  onError: (err: unknown, indexerId: string) => void,
) {
  const queue = [...ids]

  async function worker() {
    for (let id = queue.shift(); id; id = queue.shift()) {
      try {
        await checkIndexer(id)
      }
      catch (err) {
        onError(err, id)
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

/** Меняется только ссылка открытия: ключ и доступность API не нужны. */
export function updateManager(
  id: string,
  input: { browserUrl: string | null },
) {
  const changed = getDb()
    .update(indexerManagers)
    .set({ browserUrl: input.browserUrl })
    .where(eq(indexerManagers.id, id))
    .run()
    .changes

  return changed ? getManager(id) : undefined
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
  browserUrl?: string | null,
  importNewznab = manager.importNewznab,
  newznabLanAddresses = manager.newznabLanAddresses,
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
      const protocol = item.protocol ?? 'torznab'
      if (known && known.protocol !== protocol) {
        tx.update(indexers)
          .set({ missing: true, enabled: false })
          .where(eq(indexers.id, known.id))
          .run()
        continue
      }
      const nzb = protocol === 'newznab'
      const caps = item.caps ? { caps: item.caps } : {}
      const feed = {
        supportsRss: nzb ? false : (item.supportsRss ?? null),
        priority: item.priority ?? null,
      }

      if (!known) {
        const row = tx
          .insert(indexers)
          .values({
            name: item.name,
            url: item.url,
            protocol,
            lanAddresses: nzb ? newznabLanAddresses : null,
            apiKey: encryptedKey,
            enabled: item.enabled,
            managerId: manager.id,
            externalId: item.externalId,
            knownPrivacy: item.knownPrivacy,
            isPrivate: item.knownPrivacy === 'private',
            minSeedRatio: item.minSeedRatio,
            minSeedTimeMinutes: item.minSeedTimeMinutes,
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
          ...(nzb && { lanAddresses: newznabLanAddresses }),
          ...(nzb
            && known.url !== item.url && {
            downloadOrigins: null,
            caps: null,
            checkStatus: null,
            checkedAt: null,
            enabled: false,
          }),
          apiKey: encryptedKey,
          missing: false,
          ...(item.knownPrivacy && { knownPrivacy: item.knownPrivacy }),
          ...(item.knownPrivacy === 'private'
            && known.knownPrivacy !== 'private'
            && !known.policyCustomized && { isPrivate: true }),
          ...(new URL(known.url).origin !== new URL(item.url).origin && {
            sessionCookie: null,
            checkStatus: null,
            checkedAt: null,
          }),
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
      .set({
        apiKey: encryptedKey,
        syncedAt: new Date(),
        importNewznab,
        newznabLanAddresses,
        ...(browserUrl !== undefined && { browserUrl }),
      })
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
  browserUrl?: string | null
  importNewznab?: boolean
  lanAddresses?: string[]
}

/**
 * Импорт из менеджера. Тот же менеджер (тип и адрес) повторно не заводится:
 * импорт обновляет его ключ и синхронизирует индексаторы. Пока список не
 * получен, в базе ничего не меняется.
 */
export async function importManager(input: NewManager): Promise<SyncResult> {
  const url = normalizeManagerUrl(input.url, input.kind)
  const db = getDb()

  const existing = db
    .select()
    .from(indexerManagers)
    .where(
      and(eq(indexerManagers.kind, input.kind), eq(indexerManagers.url, url)),
    )
    .get()
  const importNewznab
    = input.kind === 'prowlarr'
      && (input.importNewznab ?? existing?.importNewznab ?? false)
  const addresses = importNewznab
    ? [
        ...new Set(input.lanAddresses ?? existing?.newznabLanAddresses ?? []),
      ].sort()
    : null
  if (importNewznab) {
    try {
      if (trustedUrl(input.url).search) {
        throw new SourceError(
          'bad_response',
          'Manager address must not contain a query',
        )
      }
    }
    catch (error) {
      if (error instanceof TrustedHttpError)
        throw new SourceError('bad_response', 'Invalid manager address')
      throw error
    }
  }
  const remote = await listManagerIndexers(
    input.kind,
    url,
    input.apiKey,
    addresses ?? undefined,
  )
  const manager
    = existing
      ?? db
        .insert(indexerManagers)
        .values({ kind: input.kind, url, apiKey: encryptSecret(input.apiKey) })
        .returning()
        .get()

  return applyRemoteIndexers(
    manager,
    input.apiKey,
    remote,
    input.browserUrl,
    importNewznab,
    addresses,
  )
}

export async function syncManager(id: string): Promise<SyncResult | undefined> {
  const manager = getDb()
    .select()
    .from(indexerManagers)
    .where(eq(indexerManagers.id, id))
    .get()

  if (!manager)
    return undefined

  if (manager.importNewznab && manager.newznabLanAddresses === null) {
    throw new SourceError(
      'unreachable',
      'Manager address must be verified again',
    )
  }
  const apiKey = readStoredKey(manager.apiKey)
  const remote = await listManagerIndexers(
    manager.kind,
    manager.url,
    apiKey,
    manager.importNewznab ? (manager.newznabLanAddresses ?? []) : undefined,
  )

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

/** Секрет текущей конфигурации; ссылка поиска не даёт доступ к другому origin. */
export function indexerCookie(id: string, expectedOrigin: string) {
  const row = getDb()
    .select({ url: indexers.url, sessionCookie: indexers.sessionCookie })
    .from(indexers)
    .where(eq(indexers.id, id))
    .get()
  return row?.sessionCookie && new URL(row.url).origin === expectedOrigin
    ? readStoredKey(row.sessionCookie)
    : undefined
}
